import { useState, type FormEvent } from 'react';
import { Info } from '../Info';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { lines, validateThesis, type ThesisDraft, type ThesisStatus } from '@marsad/core';
import { Button, ErrorText } from '../ui';
import { loadTheses, saveThesis, type ThesisVersion } from '../../lib/thesis';
import { cardClass } from '../Card';
import { t } from '../../strings';
import { panelTitle } from './Panel';

const x = t.study.thesis;
const area = 'rounded-sm border border-line bg-bg p-2 text-sm text-fg';

function Version({ v }: { v: ThesisVersion }) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p>
        <span className="font-medium">{x.status}:</span> {x.statuses[v.status]}.{' '}
        <span className="text-muted">{x.savedAt(v.createdAt.slice(0, 16).replace('T', ' '))}</span>
      </p>
      <div>
        <h3 className="font-medium">{x.bull}</h3>
        <p className="whitespace-pre-wrap">{v.bull}</p>
      </div>
      <div>
        <h3 className="font-medium">{x.bear}</h3>
        <p className="whitespace-pre-wrap">{v.bear}</p>
      </div>
      <div>
        <h3 className="font-medium">{x.risks}</h3>
        <ul className="list-disc ps-5">
          {v.risks.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="font-medium">{x.changeView}</h3>
        <p className="whitespace-pre-wrap">{v.changeView}</p>
      </div>
      {v.sources.length > 0 && (
        <ul className="flex flex-col">
          {v.sources.map((s) => (
            <li key={s}>
              <a
                href={s}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center break-all underline underline-offset-2"
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

function Editor({
  ticker,
  from,
  onDone,
}: {
  ticker: string;
  from?: ThesisVersion;
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
          className="min-h-11 rounded-sm border border-line bg-bg px-2 text-fg"
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
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [latest, ...older] = q.data ?? [];
  return (
    <section aria-labelledby="thesis" className={`${cardClass} gap-3!`}>
      <h2 id="thesis" className={panelTitle}>
        {x.title}
      </h2>
      <Info>{x.intro}</Info>
      {q.isError && <ErrorText message={q.error.message} />}
      {q.data &&
        (latest ? <Version v={latest} /> : !editing && <p className="text-muted">{x.none}</p>)}
      {saved && !editing && <p className="text-sm">{x.saved}</p>}
      {q.data &&
        (editing ? (
          <Editor
            ticker={ticker}
            {...(latest ? { from: latest } : {})}
            onDone={() => {
              setEditing(false);
              setSaved(true);
            }}
          />
        ) : (
          <Button type="button" onClick={() => setEditing(true)}>
            {x.edit}
          </Button>
        ))}
      {older.length > 0 && (
        <details className="text-sm">
          <summary className="min-h-11 cursor-pointer py-2 text-muted">
            {x.history(older.length)}
          </summary>
          <div className="flex flex-col gap-4">
            {older.map((v) => (
              <Version key={v.id} v={v} />
            ))}
          </div>
        </details>
      )}
      <p className="text-xs text-muted">{x.ai}</p>
    </section>
  );
}
