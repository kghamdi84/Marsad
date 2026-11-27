import { useState } from 'react';
import { Info } from '../Info';
import { useQuery } from '@tanstack/react-query';
import { ErrorText } from '../ui';
import { loadBusinessSection } from '../../lib/studyPanels';
import { cardClass } from '../Card';
import { t } from '../../strings';
import { panelTitle } from './Panel';

const b = t.study.business;

function Text({ cik }: { cik: string }) {
  const q = useQuery({ queryKey: ['business', cik], queryFn: () => loadBusinessSection(cik) });
  if (q.isPending) return <p className="text-muted">{b.loading}</p>;
  if (q.isError) return <ErrorText message={q.error.message} />;
  if (q.data === null) return <p className="text-muted">{b.none}</p>;
  const s = q.data;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted">
        {b.filed(s.periodEnd, s.filingDate)}{' '}
        <a
          href={s.filingUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex min-h-11 items-center underline"
        >
          {b.view}
        </a>
      </p>
      <div
        // A scrolling box must be reachable by keyboard (WCAG 2.1.1); the label names it for screen readers.
        tabIndex={0}
        role="region"
        aria-label={b.textLabel}
        className="max-h-[32rem] overflow-y-auto rounded-sm border border-line p-3 text-sm whitespace-pre-line focus:outline focus:outline-focus"
      >
        {s.text}
      </div>
    </div>
  );
}

/** The company's own business description (10-K Item 1), loaded only when opened. */
export function Business({ cik }: { cik: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section aria-labelledby="business" className={`${cardClass} gap-3!`}>
      <h2 id="business" className={panelTitle}>
        {b.title}
      </h2>
      <Info>{b.intro}</Info>
      <details
        className="rounded-sm border border-line p-3"
        onToggle={(e) => setOpen(e.currentTarget.open)}
      >
        <summary className="flex min-h-11 cursor-pointer items-center">{b.open}</summary>
        {open && <Text cik={cik} />}
      </details>
    </section>
  );
}
