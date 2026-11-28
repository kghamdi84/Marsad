/**
 * One Study view, loaded as its own chunk the first time it is opened (ADR 0048: lazy chunks per Study view).
 * StudyCompany renders it behind the view tabs; this module holds only what the view shows.
 */
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { EarningsEstimate } from '@marsad/core';
import type { StudyData } from '../../../lib/study';
import { loadEarningsFilings } from '../../../lib/studyPanels';
import { Earnings } from '../Earnings';
import { EarningsView } from '../research/Earnings';
import { parts, useCompanyResearch, useDividendHistory, useFacts } from '../research/Research';

function EarningsResearch({
  data,
  estimate,
}: {
  data: StudyData;
  estimate: EarningsEstimate | null | undefined;
}) {
  const cik = data.company?.cik;
  const rq = useCompanyResearch(data.ticker);
  const facts = useFacts(cik);
  const divs = useDividendHistory(data.ticker);
  const filings = useQuery({
    queryKey: ['earnings-filings', cik],
    queryFn: () => loadEarningsFilings(cik as string),
    enabled: cik !== undefined,
  });
  const p = parts(rq.data);
  return (
    <EarningsView
      cik={cik}
      facts={cik === undefined ? [] : (facts.data ?? null)}
      filings={cik === undefined ? [] : (filings.data ?? null)}
      estimate={estimate}
      thesis={p.thesis}
      calendar={p.calendar}
      dividends={divs.data ?? null}
    />
  );
}

/** Earnings: the next results line (passed in), the history with past reactions and the research view. */
export function StudyEarnings({
  data,
  lead,
  estimate,
}: {
  data: StudyData;
  lead: ReactNode;
  estimate: EarningsEstimate | null | undefined;
}) {
  const cik = data.company?.cik;
  return (
    <>
      {lead}
      {cik && <Earnings cik={cik} bars={data.bars} splits={data.splits} />}
      <EarningsResearch data={data} estimate={estimate} />
    </>
  );
}
