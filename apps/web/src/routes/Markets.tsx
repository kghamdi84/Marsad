import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { etDate } from '@marsad/core';
import { Segmented, SkeletonCards } from '../components/Card';
import { Info } from '../components/Info';
import { PageTitle } from '../components/ui/kit';
import { CALENDAR_DAYS, MarketsSummary } from '../components/markets/Summary';
import type { MarketsView } from '../components/markets/SeeAll';
import { RegimeView } from '../components/regime/RegimeView';
import { CalendarCard } from '../components/watch/CalendarCard';
import { DividendCalendar } from '../components/watch/DividendCalendar';
import { SectorsCard } from '../components/watch/Market';
import { MarketMovers } from '../components/watch/Movers';
import { Failure, useNow } from '../components/watch/shared';
import { loadHoldings } from '../lib/journal';
import { loadCalendar, loadCompanies, loadWatch } from '../lib/watch';
import { useView } from '../lib/view';
import { t } from '../strings';

const mk = t.markets;

/** The views ADR 0048 gives Markets, in order; it opens on the regime, never on movers. */
export const MARKETS_VIEWS = ['regime', 'movers', 'sectors', 'calendar'] as const;

/** Filings shown with company names: the same 10-day window as Watch, so the two pages share one read. */
const FILING_DAYS = 10;

/** Earnings, macro releases and ex-dividend dates for the watchlist and holdings, 30 days ahead. */
function CalendarView({ now }: { now: Date }) {
  const today = etDate(now);
  const cal = useQuery({ queryKey: ['calendar'], queryFn: loadCalendar });
  const wq = useQuery({ queryKey: ['watch'], queryFn: loadWatch });
  const hq = useQuery({ queryKey: ['holdings'], queryFn: loadHoldings });
  const tickers = useMemo(
    () =>
      [
        ...new Set([
          ...(wq.data?.tickers ?? []),
          ...(hq.data?.holdings ?? []).map((h) => h.ticker),
        ]),
      ].sort(),
    [wq.data, hq.data],
  );
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - FILING_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const co = useQuery({
    queryKey: ['companies', tickers, since],
    queryFn: () => loadCompanies(tickers, since),
    enabled: !!wq.data && !hq.isPending,
  });
  return (
    <div className="flex flex-col gap-4">
      <Info>{mk.calendarIntro}</Info>
      {cal.isPending && <SkeletonCards heights={['14rem']} />}
      {cal.isError && <Failure message={cal.error.message} />}
      {cal.data && <CalendarCard data={cal.data} now={now} days={CALENDAR_DAYS} />}
      <DividendCalendar
        tickers={tickers}
        bars={{ ...(wq.data?.bars ?? {}), ...(hq.data?.bars ?? {}) }}
        names={co.data?.names ?? {}}
        now={now}
      />
    </div>
  );
}

function SectorsView() {
  const wq = useQuery({ queryKey: ['watch'], queryFn: loadWatch });
  if (wq.isPending) return <SkeletonCards heights={['12rem']} />;
  if (wq.isError) return <Failure message={wq.error.message} />;
  return <SectorsCard data={wq.data} />;
}

/**
 * Markets (ADR 0048, replacing the Regime page): a summary card first, then one view at a time: the regime as
 * before, the whole-market movers of the last completed session, the sector funds, and the calendar. The view is
 * in the URL (`?view=`); `/regime` redirects here with `?view=regime`.
 */
export function Markets() {
  const now = useNow();
  const [view, setView] = useView<MarketsView>('marsad.markets.view', MARKETS_VIEWS, 'regime');
  const go = (k: MarketsView) => {
    setView(k);
    requestAnimationFrame(() =>
      document.getElementById('markets-area')?.scrollIntoView({ block: 'start' }),
    );
  };
  return (
    <div className="flex flex-col gap-5">
      <PageTitle
        page="markets"
        aside={
          <span className="flex items-center gap-2">
            {/* Desktop and iPad reach the Screener from here; phones from the More sheet (ADR 0048). */}
            <Link
              to="/screener"
              className="hidden min-h-11 items-center rounded-lg border border-line-strong px-3 text-[13px] font-semibold text-ink tablet:inline-flex"
            >
              {mk.screenerLink}
            </Link>
            <Info>{mk.intro}</Info>
          </span>
        }
      />
      <MarketsSummary go={go} now={now} />
      <div id="markets-area" className="flex scroll-mt-20 flex-col gap-3">
        <Segmented
          label={mk.viewsLabel}
          options={MARKETS_VIEWS.map((k) => ({ key: k, label: mk.views[k] }))}
          value={view}
          onChange={setView}
        />
        {view === 'regime' && <RegimeView />}
        {view === 'movers' && <MarketMovers />}
        {view === 'sectors' && <SectorsView />}
        {view === 'calendar' && <CalendarView now={now} />}
      </div>
    </div>
  );
}
