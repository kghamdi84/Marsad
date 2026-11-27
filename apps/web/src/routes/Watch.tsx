import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { etDate, tickerSummary } from '@marsad/core';
import { SkeletonCards } from '../components/Card';
import { PageTitle, Pill } from '../components/ui/kit';
import { Cockpit } from '../components/watch/Cockpit';
import { Strip } from '../components/watch/Strip';
import { WatchlistCard } from '../components/watch/WatchlistCard';
import { NewsCard } from '../components/watch/NewsCard';
import { CalendarCard } from '../components/watch/CalendarCard';
import { GapsCard, MoversCard, MoversGapsPhone, SectorsCard } from '../components/watch/Market';
import { Failure, useNow, v } from '../components/watch/shared';
import { loadHoldings } from '../lib/journal';
import { weekdayDayMonth } from '../lib/dates';
import { loadBriefs, loadCalendar, loadCockpit, loadCompanies, loadWatch } from '../lib/watch';

/** Filings shown as news: the last 10 days. */
const FILING_DAYS = 10;

const pairCols = 'grid-cols-[repeat(auto-fit,minmax(min(100%,380px),1fr))] items-start gap-5';
const pairGrid = `grid ${pairCols}`;

/**
 * Watch (Marsad v2): the morning decision cockpit with the brief, the market strip, the watchlist, latest news
 * ranked by impact, the calendar, US sectors, and the universe movers and gap scanner. End-of-day data, each
 * number with its date.
 */
export function Watch() {
  const now = useNow();
  const today = etDate(now);
  const cal = useQuery({ queryKey: ['calendar'], queryFn: loadCalendar });
  const wq = useQuery({ queryKey: ['watch'], queryFn: loadWatch });
  const bq = useQuery({ queryKey: ['briefs'], queryFn: loadBriefs });
  const hq = useQuery({ queryKey: ['holdings'], queryFn: loadHoldings });
  const cq = useQuery({ queryKey: ['cockpit', today], queryFn: () => loadCockpit(today) });
  const heldList = useMemo(
    () => [...new Set((hq.data?.holdings ?? []).map((h) => h.ticker))].sort(),
    [hq.data],
  );
  const held = useMemo(() => new Set(heldList), [heldList]);
  const companyTickers = useMemo(
    () => [...new Set([...(wq.data?.tickers ?? []), ...heldList])].sort(),
    [wq.data, heldList],
  );
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - FILING_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const co = useQuery({
    queryKey: ['companies', companyTickers, since],
    queryFn: () => loadCompanies(companyTickers, since),
    // Wait for the holdings (or their failure) so held names are in the one read.
    enabled: !!wq.data && !hq.isPending,
  });
  const session = wq.data ? tickerSummary(wq.data.bars['SPY'] ?? [])?.date : undefined;
  return (
    <div className="flex flex-col gap-5">
      <PageTitle
        page="watch"
        aside={
          session ? (
            <Pill className="px-2.5 py-1">{v.sourceChip(weekdayDayMonth(session))}</Pill>
          ) : undefined
        }
      />
      <Cockpit
        now={now}
        briefs={{ data: bq.data, error: bq.error }}
        watch={wq.data}
        cal={{ data: cal.data, error: cal.error }}
        cockpit={{ data: cq.data, error: cq.error }}
        filings={{ data: co.data?.filings, error: co.error }}
        holdings={{ data: hq.data, error: hq.error }}
      />
      {wq.isPending && <SkeletonCards />}
      {wq.isError && <Failure message={wq.error.message} />}
      {wq.data && (
        <>
          <Strip data={wq.data} />
          <WatchlistCard data={wq.data} names={co.data?.names ?? {}} held={held} />
        </>
      )}
      <div className={pairGrid}>
        {wq.data && (
          <NewsCard
            data={wq.data}
            filings={co.data?.filings ?? []}
            holdings={heldList}
            topics={cq.data?.topics ?? []}
            readAt={wq.dataUpdatedAt}
          />
        )}
        {cal.isPending && !wq.isPending && <SkeletonCards heights={['14rem']} />}
        {cal.isError && <Failure message={cal.error.message} />}
        {cal.data && <CalendarCard data={cal.data} now={now} />}
      </div>
      {wq.data && (
        <>
          <SectorsCard data={wq.data} />
          <div className={`hidden tablet:grid ${pairCols}`}>
            <MoversCard data={wq.data} />
            <GapsCard data={wq.data} />
          </div>
          <div className="tablet:hidden">
            <MoversGapsPhone data={wq.data} />
          </div>
        </>
      )}
    </div>
  );
}
