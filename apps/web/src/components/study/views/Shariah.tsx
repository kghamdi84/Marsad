/**
 * One Study view, loaded as its own chunk the first time it is opened (ADR 0048: lazy chunks per Study view).
 * StudyCompany renders it behind the view tabs; this module holds only what the view shows.
 */
import type { StudyData } from '../../../lib/study';
import { ShariahAid } from '../ShariahAid';

export function StudyShariah({ data }: { data: StudyData }) {
  const cik = data.company?.cik;
  return cik ? <ShariahAid cik={cik} bars={data.bars} /> : null;
}
