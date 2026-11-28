/**
 * One Study view, loaded as its own chunk the first time it is opened (ADR 0048: lazy chunks per Study view).
 * StudyCompany renders it behind the view tabs; this module holds only what the view shows.
 */
import type { ReactNode } from 'react';
import type { StudyData } from '../../../lib/study';
import { t } from '../../../strings';
import { Financials } from '../Financials';
import { FinancialsView } from '../research/Financials';
import { useFacts } from '../research/Research';
import { R } from '../research/shared';

function FinancialsResearch({
  data,
  onOpenStatements,
}: {
  data: StudyData;
  onOpenStatements?: () => void;
}) {
  const cik = data.company?.cik;
  const facts = useFacts(cik);
  return (
    <FinancialsView
      facts={facts.data ?? null}
      factsError={
        facts.isError ? t.study.panelError(R.views.financials, facts.error.message) : null
      }
      hasCompany={cik !== undefined}
      onOpenStatements={onOpenStatements}
    />
  );
}

/** Financials: the snapshot (passed in, it shares the page's summary), the statements and the research view. */
export function StudyFinancials({ data, lead }: { data: StudyData; lead: ReactNode }) {
  const cik = data.company?.cik;
  return (
    <>
      {lead}
      {cik && <Financials cik={cik} bars={data.bars} />}
      <FinancialsResearch data={data} />
    </>
  );
}
