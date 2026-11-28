import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { etDate, tickerSummary } from '@marsad/core';
import { Segmented, SkeletonCards, useRemembered } from '../components/Card';
import { PageTitle, Pill } from '../components/ui/kit';
import { Cockpit } from '../components/watch/Cockpit';
import { Strip } from '../components/watch/Strip';
import { WatchlistCard } from '../components/watch/WatchlistCard';
import { NewsCard } from '../components/watch/NewsCard';
import { CalendarCard } from '../components/watch/CalendarCard';
import { DividendCalendar } from '../components/watch/DividendCalendar';
import { GapsCard, SectorsCard } from '../components/watch/Market';
import { UniverseMoversCard } from '../components/watch/Movers';
import { SeeAll } from '../components/markets/SeeAll';
import { Failure, useNow, v } from '../components/watch/shared';
import { loadHoldings } from '../lib/journal';
import { weekdayDayMonth } from '../lib/dates';
import { loadBriefs, loadCalendar, loadCockpit, loadCompanies, loadWatch } from '../lib/watch';
import { useLiveNews } from '../lib/liveNews';

/** Filings shown as news: the last 10 days. */
const FILING_DAYS = 10;

const FEED_TABS = ['news', 'calendar', 'dividends'] as const;
const MARKET_TABS = ['sectors', 'movers', 'gaps'] as const;

/**
 * Watch (Marsad v2, squeezed): one Today card (regime, movers, today's events, exit rules, the brief one tap away),
 * the market strip, the watchlist, then two switchable cards: news or calendar, and sectors, movers or gaps. Nothing
 * is dropped; each view is one tap away and the choice is remembered. End-of-day data, each number with its date.
 * The calendar, sectors and movers cards end in a "See all" link into Markets (ADR 0048); Watch's movers are the
 * Marsad universe's, and the whole market is on Markets.
 */
export function Watch() {
  const now = useNow();
  const today = etDate(now);
  const cal = useQuery({ queryKey: ['calendar'], queryFn: loadCalendar });
  const wq = useQuery({ queryKey: ['watch'], queryFn: loadWatch });
  const live = useLiveNews();
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
  const [feed, setFeed] = useRemembered('marsad.watch.feed', FEED_TABS, 'news');
  const [market, setMarket] = useRemembered('marsad.watch.market', MARKET_TABS, 'sectors');
  const sw = v.switch;
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
      <div className="flex flex-col gap-2.5">
        <Segmented
          label={sw.feedLabel}
          options={FEED_TABS.map((key) => ({ key, label: sw.feed[key] }))}
          value={feed}
          onChange={setFeed}
        />
        {feed === 'news' ? (
          wq.data && (
            <NewsCard
              data={wq.data}
              filings={co.data?.filings ?? []}
              holdings={heldList}
              topics={cq.data?.topics ?? []}
              readAt={wq.dataUpdatedAt}
              live={live}
            />
          )
        ) : feed === 'dividends' ? (
          <>
            <DividendCalendar
              tickers={companyTickers}
              bars={{ ...(wq.data?.bars ?? {}), ...(hq.data?.bars ?? {}) }}
              names={co.data?.names ?? {}}
              now={now}
            />
            <SeeAll view="calendar" />
          </>
        ) : (
          <>
            {cal.isPending && <SkeletonCards heights={['14rem']} />}
            {cal.isError && <Failure message={cal.error.message} />}
            {cal.data && <CalendarCard data={cal.data} now={now} />}
            <SeeAll view="calendar" />
          </>
        )}
      </div>
      {wq.data && (
        <div className="flex flex-col gap-2.5">
          <Segmented
            label={sw.marketLabel}
            options={MARKET_TABS.map((key) => ({ key, label: sw.market[key] }))}
            value={market}
            onChange={setMarket}
          />
          {market === 'sectors' && (
            <>
              <SectorsCard data={wq.data} />
              <SeeAll view="sectors" />
            </>
          )}
          {market === 'movers' && (
            <>
              <UniverseMoversCard movers={wq.data.movers} />
              <SeeAll view="movers" />
            </>
          )}
          {market === 'gaps' && <GapsCard data={wq.data} />}
        </div>
      )}
    </div>
  );
}
