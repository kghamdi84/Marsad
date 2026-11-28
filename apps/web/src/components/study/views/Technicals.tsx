/**
 * One Study view, loaded as its own chunk the first time it is opened (ADR 0048: lazy chunks per Study view).
 * StudyCompany renders it behind the view tabs; this module holds only what the view shows.
 */
import type { StudyData } from '../../../lib/study';
import { TechnicalsView } from '../research/Technicals';

function TechnicalsSection({ data }: { data: StudyData }) {
  return <TechnicalsView bars={data.bars} />;
}

export function StudyTechnicals({ data }: { data: StudyData }) {
  return <TechnicalsSection data={data} />;
}
