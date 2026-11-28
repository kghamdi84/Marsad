/**
 * One Study view, loaded as its own chunk the first time it is opened (ADR 0048: lazy chunks per Study view).
 * StudyCompany renders it behind the view tabs; this module holds only what the view shows.
 */
import type { StudyData } from '../../../lib/study';
import { NewsPanel } from '../NewsPanel';
import { NewsView } from '../research/News';

function NewsResearch({ data }: { data: StudyData }) {
  return <NewsView ticker={data.ticker} bars={data.bars} />;
}

export function StudyNews({ data }: { data: StudyData }) {
  return (
    <>
      <NewsPanel ticker={data.ticker} />
      <NewsResearch data={data} />
    </>
  );
}
