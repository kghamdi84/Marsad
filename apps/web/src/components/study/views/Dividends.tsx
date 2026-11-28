/**
 * One Study view, loaded as its own chunk the first time it is opened (ADR 0048: lazy chunks per Study view).
 * StudyCompany renders it behind the view tabs; this module holds only what the view shows.
 */
import type { ComponentProps } from 'react';
import type { StudyData } from '../../../lib/study';
import { t } from '../../../strings';
import { Dividends } from '../Dividends';
import { DividendsView } from '../research/Dividends';
import { parts, useCompanyResearch, useDividendHistory, useFacts } from '../research/Research';
import { R } from '../research/shared';

function DividendsResearch({ data }: { data: StudyData }) {
  const rq = useCompanyResearch(data.ticker);
  const facts = useFacts(data.company?.cik);
  const divs = useDividendHistory(data.ticker);
  const p = parts(rq.data);
  return (
    <DividendsView
      ticker={data.ticker}
      bars={data.bars}
      dividends={divs.data ?? null}
      dividendsError={
        divs.isError ? t.study.panelError(R.views.dividends, divs.error.message) : null
      }
      facts={facts.data ?? null}
      profile={p.profile}
      analyst={p.analyst}
    />
  );
}

export function StudyDividends({
  data,
  rows,
}: {
  data: StudyData;
  rows: ComponentProps<typeof Dividends>['rows'];
}) {
  return (
    <>
      <Dividends rows={rows} />
      <DividendsResearch data={data} />
    </>
  );
}
