import { useMemo, useState } from 'react';
import { Info } from '../Info';
import { useQuery } from '@tanstack/react-query';
import { diffRiskFactors } from '@marsad/core';
import { ErrorText } from '../ui';
import { loadQuarterlySections } from '../../lib/studyPanels';
import { Result } from './RiskFactors';
import { t } from '../../strings';
import { panelTitle, tileClass } from './Panel';

const k = t.study.quarterly;

function Body({ cik }: { cik: string }) {
  const q = useQuery({ queryKey: ['quarterly', cik], queryFn: () => loadQuarterlySections(cik) });
  const [newer, older] = q.data ?? [];
  const diff = useMemo(
    () => (newer && older ? diffRiskFactors(older.text, newer.text) : null),
    [newer, older],
  );
  if (q.isPending) return <p className="text-muted">{k.loading}</p>;
  if (q.isError) return <ErrorText message={q.error.message} />;
  if (!newer) return <p className="text-muted">{k.none}</p>;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">
        {k.newest(newer.filingDate)}.{' '}
        <a
          href={newer.filingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center underline"
        >
          {k.view}
        </a>
      </p>
      <p className="text-sm font-medium">{newer.noMaterialChanges ? k.unchanged : k.changes}</p>
      <div
        tabIndex={0}
        role="region"
        aria-label={k.textLabel}
        className="max-h-[24rem] overflow-y-auto rounded-sm border border-line p-3 text-sm whitespace-pre-line focus:outline focus:outline-focus"
      >
        {newer.text}
      </div>
      {older && diff ? (
        <>
          <p className="text-sm text-muted">{k.compare(newer.filingDate, older.filingDate)}</p>
          <Result diff={diff} />
        </>
      ) : (
        <p className="text-sm text-muted">{k.oneOnly}</p>
      )}
    </div>
  );
}

/** Quarterly risk-factor updates (ADR 0036), loaded only when opened. */
export function QuarterlyRiskFactors({ cik }: { cik: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section aria-labelledby="quarterly" className={tileClass}>
      <h2 id="quarterly" className={panelTitle}>
        {k.title}
      </h2>
      <Info>{k.intro}</Info>
      <details
        className="rounded-sm border border-line p-3"
        onToggle={(e) => setOpen(e.currentTarget.open)}
      >
        <summary className="flex min-h-11 cursor-pointer items-center">{k.open}</summary>
        {open && <Body cik={cik} />}
      </details>
    </section>
  );
}
