/**
 * One Study view, loaded as its own chunk the first time it is opened (ADR 0048: lazy chunks per Study view).
 * StudyCompany renders it behind the view tabs; this module holds only what the view shows.
 */
import type { StudyData } from '../../../lib/study';
import { AnalystsView, NextQuarterEstimate, RecommendationTrend } from '../research/Analysts';
import { ResearchStatus, parts, useCompanyResearch } from '../research/Research';

function AnalystsSection({ data }: { data: StudyData }) {
  const rq = useCompanyResearch(data.ticker);
  const p = parts(rq.data);
  return (
    <>
      <ResearchStatus ticker={data.ticker} />
      <AnalystsView ticker={data.ticker} analyst={p.analyst} bars={data.bars} />
      <RecommendationTrend ticker={data.ticker} />
      <NextQuarterEstimate calendar={p.calendar} />
    </>
  );
}

export function StudyAnalysts({ data }: { data: StudyData }) {
  return <AnalystsSection data={data} />;
}
