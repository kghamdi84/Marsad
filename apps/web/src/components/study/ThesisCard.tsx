import { useState, type FormEvent } from 'react';
import { Info } from '../Info';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  lines,
  parseThesisDraft,
  validateThesis,
  type ThesisDraft,
  type ThesisStatus,
} from '@marsad/core';
import { Button, ErrorText } from '../ui';
import { Pill, type Tone } from '../ui/kit';
import { AiSources, modelName, reasonText } from '../AiSources';
import { isVerifiedModelText, loadLatestAiOutput, type AiOutput } from '../../lib/ai';
import { loadTheses, saveThesis, type ThesisVersion } from '../../lib/thesis';
import { t } from '../../strings';
import { panelTitle, tileClass } from './Panel';

const x = t.study.thesis;
const area = 'rounded-lg border border-line-strong bg-surface p-2 text-sm text-ink';

const STATUS_TONE: Record<string, Tone> = { intact: 'up', weakening: 'warn', broken: 'down' };

function Version({ v }: { v: ThesisVersion }) {
  return (
    <div className="flex flex-col gap-2.5 text-[13px] leading-relaxed text-ink2">
      <p className="flex flex-wrap items-center gap-2">
        <Pill tone={STATUS_TONE[v.status] ?? 'neutral'} className="font-semibold">
          {x.status}: {x.statuses[v.status]}.
        </Pill>
        <span className="text-xs text-ink3">
          {x.savedAt(v.createdAt.slice(0, 16).replace('T', ' '))}
        </span>
      </p>
      <div>
        <h3 className="inline font-semibold text-ink">{x.bull}: </h3>
        <p className="inline whitespace-pre-wrap">{v.bull}</p>
      </div>
      <div className="rounded-lg bg-down-soft p-3 text-ink">
        <h3 className="inline font-semibold text-down">{x.bear}: </h3>
        <p className="inline whitespace-pre-wrap">{v.bear}</p>
      </div>
      <div>
        <h3 className="font-semibold text-ink">{x.risks}</h3>
        <ul className="list-disc ps-5">
          {v.risks.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="inline font-semibold text-ink">{x.changeView}: </h3>
        <p className="inline whitespace-pre-wrap">{v.changeView}</p>
      </div>
      {v.sources.length > 0 && (
        <ul className="flex flex-col">
          {v.sources.map((s) => (
            <li key={s}>
              <a
                href={s}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center break-all text-link underline underline-offset-2"
              >
                {s}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** What the editor can start from: the newest saved version, or an AI draft. */
type EditorSeed = Pick<
  ThesisDraft,
  'status' | 'bull' | 'bear' | 'risks' | 'changeView' | 'sources'
>;

/** The AI draft as editor text: citations removed, the cited filings' links as sources (at most 10). */
export function draftSeed(o: AiOutput, status: ThesisStatus): EditorSeed | null {
  const parts = parseThesisDraft(o.text);
  if (!parts) return null;
  const urls = [
    ...new Set(o.citations.map((c) => c.url).filter((u): u is string => u !== null)),
  ].slice(0, 10);
  return {
    status,
    bull: parts.bull,
    bear: parts.bear,
    risks: parts.risks,
    changeView: parts.changeView,
    sources: urls,
  };
}

/**
 * The AI draft (checklist 2.10): shown only when the model wrote it and the verifier passed it, labelled as a draft
 * to check, with its sources. Starting from it fills the form; nothing is saved until Khaled saves.
 */
function AiDraft({
  draft,
  onUse,
}: {
  draft: AiOutput | null | undefined;
  onUse: (o: AiOutput) => void;
}) {
  if (draft === undefined) return null;
  if (draft === null) return <p className="text-xs text-ink3">{x.ai}</p>;
  if (!isVerifiedModelText(draft) || !parseThesisDraft(draft.text))
    return (
      <p className="text-xs text-ink3">{x.aiDraft.unavailable(reasonText(draft.fallbackReason))}</p>
    );
  return (
    <section
      aria-labelledby="thesis-ai-draft"
      className="flex flex-col gap-2 rounded-lg border border-dashed border-line-strong p-3"
    >
      <h3 id="thesis-ai-draft" className="text-sm font-semibold text-ink">
        <Pill tone="warn">{x.aiDraft.title}</Pill>
      </h3>
      <p className="text-xs text-ink3">{x.aiDraft.note}</p>
      <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-ink2">{draft.text}</p>
      <p className="text-xs text-ink3">
        {t.common.ai.asOf(
          draft.createdAt.slice(0, 10),
          modelName(draft.servedModel ?? draft.model),
        )}
      </p>
      <AiSources citations={draft.citations} label={x.aiDraft.title} />
      <Button type="button" onClick={() => onUse(draft)}>
        {x.aiDraft.use}
      </Button>
    </section>
  );
}

function Editor({
  ticker,
  from,
  onDone,
}: {
  ticker: string;
  from?: EditorSeed;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<ThesisStatus>(from?.status ?? 'intact');
  const [bull, setBull] = useState(from?.bull ?? '');
  const [bear, setBear] = useState(from?.bear ?? '');
  const [risks, setRisks] = useState((from?.risks ?? []).join('\n'));
  const [changeView, setChangeView] = useState(from?.changeView ?? '');
  const [sources, setSources] = useState((from?.sources ?? []).join('\n'));
  const [errors, setErrors] = useState<string[]>([]);
  const save = useMutation({
    mutationFn: saveThesis,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['theses', ticker] });
      void qc.invalidateQueries({ queryKey: ['holdings'] });
      onDone();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const d: ThesisDraft = {
      ticker,
      status,
      bull,
      bear,
      risks: lines(risks),
      changeView,
      sources: lines(sources),
    };
    const problems = validateThesis(d);
    setErrors(problems);
    if (problems.length === 0) save.mutate(d);
  };
  const box = (id: string, label: string, value: string, set: (v: string) => void, rows = 3) => (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        className={area}
        value={value}
        onChange={(e) => set(e.target.value)}
      />
    </div>
  );
  return (
    <form onSubmit={submit} className="flex flex-col gap-3" aria-label={x.edit}>
      <label className="flex flex-col gap-1 text-sm font-medium">
        {x.status}
        <select
          className="min-h-11 rounded-lg border border-line-strong bg-surface px-2 text-ink"
          value={status}
          onChange={(e) => setStatus(e.target.value as ThesisStatus)}
        >
          {(['intact', 'weakening', 'broken'] as const).map((k) => (
            <option key={k} value={k}>
              {x.statuses[k]}
            </option>
          ))}
        </select>
      </label>
      {box('th-bull', x.bull, bull, setBull)}
      {box('th-bear', x.bear, bear, setBear)}
      {box('th-risks', x.risks, risks, setRisks)}
      {box('th-change', x.changeView, changeView, setChangeView, 2)}
      {box('th-sources', x.sources, sources, setSources, 2)}
      <Button type="submit" disabled={save.isPending}>
        {x.save}
      </Button>
      {errors.map((m) => (
        <ErrorText key={m} message={m} />
      ))}
      {save.isError && <ErrorText message={save.error.message} />}
    </form>
  );
}

export function ThesisCard({ ticker }: { ticker: string }) {
  const q = useQuery({ queryKey: ['theses', ticker], queryFn: () => loadTheses(ticker) });
  const ai = useQuery({
    queryKey: ['ai-output', 'thesis-draft', ticker],
    queryFn: () => loadLatestAiOutput('thesis-draft', ticker),
  });
  const [editing, setEditing] = useState(false);
  const [seed, setSeed] = useState<EditorSeed | null>(null);
  const [saved, setSaved] = useState(false);
  const [latest, ...older] = q.data ?? [];
  return (
    <section aria-labelledby="thesis" className={tileClass}>
      <h2 id="thesis" className={panelTitle}>
        {x.title}
      </h2>
      <Info>{x.intro}</Info>
      {q.isError && <ErrorText message={q.error.message} />}
      {q.data &&
        (latest ? (
          <Version v={latest} />
        ) : (
          !editing && <p className="text-sm text-ink3">{x.none}</p>
        ))}
      {saved && !editing && <p className="text-sm">{x.saved}</p>}
      {q.data &&
        (editing ? (
          <Editor
            ticker={ticker}
            {...(seed ? { from: seed } : latest ? { from: latest } : {})}
            onDone={() => {
              setEditing(false);
              setSeed(null);
              setSaved(true);
            }}
          />
        ) : (
          <Button
            type="button"
            onClick={() => {
              setSeed(null);
              setEditing(true);
            }}
          >
            {x.edit}
          </Button>
        ))}
      {!editing && (
        <AiDraft
          draft={ai.isError ? null : ai.data}
          onUse={(o) => {
            const s0 = draftSeed(o, latest?.status ?? 'intact');
            if (!s0) return;
            setSeed(s0);
            setSaved(false);
            setEditing(true);
          }}
        />
      )}
      {older.length > 0 && (
        <details className="text-sm">
          <summary className="min-h-11 cursor-pointer py-2 text-ink3">
            {x.history(older.length)}
          </summary>
          <div className="flex flex-col gap-4">
            {older.map((v) => (
              <Version key={v.id} v={v} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
