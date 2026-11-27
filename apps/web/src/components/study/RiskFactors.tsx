import { useMemo, useState } from 'react';
import { Info } from '../Info';
import { useQuery } from '@tanstack/react-query';
import {
  CHANGED_SENTENCE_DICE,
  diffRiskFactors,
  latestYearOverYear,
  toFixedHalfUp,
  type ChangedSentence,
  type RiskDiff,
  type Sentence,
  type WordSegment,
} from '@marsad/core';
import { loadRiskFactorSections } from '../../lib/studyPanels';
import { cardClass } from '../Card';
import { t } from '../../strings';
import { panelTitle } from './Panel';

const FIRST = 12;

/** A group of sentences, newest context first-seen order, showing the first few and the rest on request. */
function Group<T>({
  title,
  items,
  render,
}: {
  title: string;
  items: readonly T[];
  render: (item: T, index: number) => React.ReactNode;
}) {
  const [all, setAll] = useState(false);
  const r = t.study.risk;
  const shown = all ? items : items.slice(0, FIRST);
  return (
    <div className="flex flex-col gap-2">
      <h3 className="mt-2 text-sm font-medium">
        {title} ({items.length})
      </h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{r.nothing}</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {shown.map((item, i) => (
            <li key={i} className="rounded-sm border border-line p-2">
              {render(item, i)}
            </li>
          ))}
        </ul>
      )}
      {items.length > FIRST && (
        <button
          type="button"
          className="min-h-11 self-start rounded-sm border border-line px-3"
          onClick={() => setAll(!all)}
        >
          {all ? r.showFewer : r.showAll(items.length)}
        </button>
      )}
    </div>
  );
}

function SentenceItem({ s }: { s: Sentence }) {
  return (
    <>
      <p>{s.text}</p>
      {s.context && <p className="text-xs text-muted">{t.study.risk.under(s.context)}</p>}
    </>
  );
}

function Words({ segments }: { segments: readonly WordSegment[] }) {
  const r = t.study.risk;
  return (
    <p>
      {segments.map((w, i) =>
        w.op === 'same' ? (
          <span key={i}>{w.text} </span>
        ) : w.op === 'added' ? (
          <ins key={i} className="font-medium underline underline-offset-2">
            <span className="sr-only">{r.wordAdded}: </span>
            {w.text}{' '}
          </ins>
        ) : (
          <del key={i} className="text-muted line-through">
            <span className="sr-only">{r.wordRemoved}: </span>
            {w.text}{' '}
          </del>
        ),
      )}
    </p>
  );
}

function ChangedItem({ c }: { c: ChangedSentence }) {
  return (
    <>
      <Words segments={c.words} />
      <p className="text-xs text-muted">
        {t.study.risk.similarity(toFixedHalfUp(c.similarity, 2))}
        {c.after.context ? ` | ${t.study.risk.under(c.after.context)}` : ''}
      </p>
    </>
  );
}

export function Result({ diff }: { diff: RiskDiff }) {
  const r = t.study.risk;
  return (
    <>
      <p className="text-sm font-medium">
        {r.counts(diff.added.length, diff.removed.length, diff.changed.length, diff.unchanged)}
      </p>
      <p className="text-xs text-muted">{r.summaryNote}</p>
      <p className="text-xs text-muted">{r.cutoff(toFixedHalfUp(CHANGED_SENTENCE_DICE, 1))}</p>
      <Group title={r.added} items={diff.added} render={(s) => <SentenceItem s={s} />} />
      <Group title={r.removed} items={diff.removed} render={(s) => <SentenceItem s={s} />} />
      <Group title={r.changed} items={diff.changed} render={(c) => <ChangedItem c={c} />} />
      <p className="text-xs text-muted">{r.provenance(diff.formulaVersion)}</p>
    </>
  );
}

/** Loads and compares the two reports. Mounted only once the section is opened: each report is about 110 KB. */
function Comparison({ cik }: { cik: string }) {
  const r = t.study.risk;
  const q = useQuery({
    queryKey: ['risk-sections', cik],
    queryFn: () => loadRiskFactorSections(cik),
  });
  const pair = useMemo(() => (q.data ? latestYearOverYear(q.data) : null), [q.data]);
  const diff = useMemo(
    () => (pair?.ok ? diffRiskFactors(pair.older.text, pair.newer.text) : null),
    [pair],
  );

  if (q.isPending) return <p className="text-muted">{r.loading}</p>;
  if (q.isError)
    return (
      <p role="alert" className="text-down">
        {t.study.panelError(r.title, q.error.message)}
      </p>
    );
  if (!pair) return null;
  if (!pair.ok) {
    if (pair.reason === 'gap' && q.data) {
      const [newer, older] = q.data;
      return <p className="text-muted">{r.gap(newer?.periodEnd ?? '', older?.periodEnd ?? '')}</p>;
    }
    return <p className="text-muted">{pair.reason === 'none' ? r.none : r.oneReport}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted">
        {r.reports(
          pair.newer.periodEnd,
          pair.newer.filingDate,
          pair.older.periodEnd,
          pair.older.filingDate,
        )}
      </p>
      <p className="flex flex-wrap gap-x-4 text-sm">
        <a
          className="inline-flex min-h-11 items-center underline underline-offset-4"
          href={pair.newer.filingUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {r.viewNewer}
        </a>
        <a
          className="inline-flex min-h-11 items-center underline underline-offset-4"
          href={pair.older.filingUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {r.viewOlder}
        </a>
      </p>
      {diff && <Result diff={diff} />}
    </div>
  );
}

export function RiskFactors({ cik }: { cik: string }) {
  const [open, setOpen] = useState(false);
  const r = t.study.risk;
  return (
    <section aria-labelledby="risk" className={`${cardClass} gap-3!`}>
      <h2 id="risk" className={panelTitle}>
        {r.title}
      </h2>
      <Info>{r.intro}</Info>
      <details
        className="rounded-sm border border-line p-3"
        onToggle={(e) => setOpen(e.currentTarget.open)}
      >
        <summary className="flex min-h-11 cursor-pointer items-center">{r.open}</summary>
        {open && <Comparison cik={cik} />}
      </details>
    </section>
  );
}
