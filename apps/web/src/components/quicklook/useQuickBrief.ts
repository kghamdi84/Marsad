import { useMemo } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { companyBrief, estimateNextEarnings, etDate, type CompanyBrief } from '@marsad/core';
import type { StudyData } from '../../lib/study';
import {
  loadBusinessSection,
  loadChartEvents,
  loadEarningsFilings,
  loadFacts,
  loadInsiders,
  loadLatestReports,
  loadNewsSentiment,
  loadRecentDailyBars,
  loadSectorFund,
  loadShortData,
  loadStrengthRank,
} from '../../lib/studyPanels';

const DAY = 86_400_000;

export type Q = Pick<UseQueryResult<unknown>, 'isSuccess' | 'isError' | 'isLoading'>;

/** True while any of the queries is fetching for the first time. */
export const busy = (...qs: Q[]) => qs.some((q) => q.isLoading);

/**
 * The company brief (company-brief-1) inputs for the quick look. Every query uses the Study page's own key and
 * loader, so opening the full study after the quick look (or the other way) reads the same cache. They start only
 * when the quick look is open (this hook lives in its body) and none of them holds up the header. Dividends, the
 * regime and the 10-Q risk flag feed no line the quick look shows, so they are left to the Study page.
 */
export function useQuickBrief(ticker: string, d: StudyData | undefined) {
  const cik = d?.company?.cik;
  const asOf = etDate(new Date());
  // The news window starts 31 days back so the 30 ET days are covered whatever the time zone (as on Study).
  const since = useMemo(
    () => new Date(Date.parse(`${asOf}T00:00:00Z`) - 31 * DAY).toISOString(),
    [asOf],
  );
  const hasCik = cik !== undefined;
  const facts = useQuery({
    queryKey: ['facts', cik],
    queryFn: () => loadFacts(cik as string),
    enabled: hasCik,
  });
  const business = useQuery({
    queryKey: ['business', cik],
    queryFn: () => loadBusinessSection(cik as string),
    enabled: hasCik,
  });
  const reports = useQuery({
    queryKey: ['latest-reports', cik],
    queryFn: () => loadLatestReports(cik as string),
    enabled: hasCik,
  });
  const results = useQuery({
    queryKey: ['earnings-filings', cik],
    queryFn: () => loadEarningsFilings(cik as string),
    enabled: hasCik,
  });
  const insiders = useQuery({
    queryKey: ['insiders', cik],
    queryFn: () => loadInsiders(cik as string),
    enabled: hasCik,
  });
  const short = useQuery({ queryKey: ['short', ticker], queryFn: () => loadShortData(ticker) });
  const news = useQuery({
    queryKey: ['news-sentiment', ticker, since],
    queryFn: () => loadNewsSentiment(ticker, since),
  });
  const sector = useQuery({
    queryKey: ['brief-sector', ticker],
    queryFn: () => loadSectorFund(ticker),
  });
  const spy = useQuery({
    queryKey: ['brief-bars', 'SPY'],
    queryFn: () => loadRecentDailyBars('SPY'),
    enabled: ticker !== 'SPY',
  });
  const strength = useQuery({
    queryKey: ['brief-strength', ticker],
    queryFn: () => loadStrengthRank(ticker),
  });
  const events = useQuery({
    queryKey: ['chart-events', ticker],
    queryFn: () => loadChartEvents(ticker),
  });

  const ok = <T>(q: UseQueryResult<T>): T | null => (q.isSuccess ? (q.data ?? null) : null);
  const spyBars = ticker === 'SPY' ? (d?.bars ?? null) : ok(spy);
  // Estimated from the stored results 8-Ks (item 2.02), as on the Study page.
  const earnings = useMemo(
    () =>
      results.data
        ? estimateNextEarnings(
            results.data.map((f) => f.filingDate),
            asOf,
          )
        : null,
    [results.data, asOf],
  );
  const brief: CompanyBrief | null = useMemo(
    () =>
      d
        ? companyBrief({
            ticker,
            asOf,
            name: d.company?.name ?? null,
            business: business.isSuccess ? business.data : null,
            bars: d.bars,
            spy: spyBars,
            sector: sector.data ? { ticker: sector.data.etf, bars: sector.data.bars } : null,
            facts: facts.isSuccess ? facts.data : null,
            strength: strength.isSuccess ? strength.data : null,
            filings: reports.isSuccess ? reports.data : null,
            news: news.data?.rows ?? null,
            newsCapped: news.data?.capped ?? false,
            insiders: insiders.data?.rows ?? null,
            shortInterest: short.data?.interest ?? null,
            dividends: null,
            earnings,
            regime: null,
            riskFactors: null,
            halts: events.data?.halts ?? null,
            alerts: events.data?.alerts ?? null,
          })
        : null,
    // The query objects change identity every render; their data is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      ticker,
      asOf,
      d,
      business.data,
      spyBars,
      sector.data,
      facts.data,
      strength.data,
      reports.data,
      news.data,
      insiders.data,
      short.data,
      earnings,
      events.data,
    ],
  );
  return {
    brief,
    cik,
    spyBars,
    earnings,
    q: { facts, business, reports, results, insiders, short, news, sector, spy, strength, events },
  };
}
