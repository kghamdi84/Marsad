/**
 * One Study view, loaded as its own chunk the first time it is opened (ADR 0048: lazy chunks per Study view).
 * StudyCompany renders it behind the view tabs; this module holds only what the view shows.
 */
import type { StudyData } from '../../../lib/study';
import { Holders13F } from '../Holders13F';
import { Insiders } from '../Insiders';
import { ShortData } from '../ShortData';
import { OwnershipBar } from '../research/Overview';
import { parts, useCompanyResearch } from '../research/Research';

function OwnershipResearch({ ticker }: { ticker: string }) {
  const rq = useCompanyResearch(ticker);
  return <OwnershipBar profile={parts(rq.data).profile} />;
}

export function StudyOwnership({ data }: { data: StudyData }) {
  const cik = data.company?.cik;
  return (
    <>
      <OwnershipResearch ticker={data.ticker} />
      {cik && <Holders13F ticker={data.ticker} />}
      {cik && <Insiders cik={cik} />}
      <ShortData ticker={data.ticker} />
    </>
  );
}
