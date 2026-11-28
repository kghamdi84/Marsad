import {
  STARTING_TICKERS,
  TICKER_SUMMARY_VERSION,
  buildCalendar,
  cumulativeFactor,
  lastCompletedTradingDay,
  normalizeTicker,
  runJob,
  tickerDailySummary,
  validateAnalyst,
  validateCalendar,
  validateProfile,
  type DailyBar,
  type JobRunRecord,
  type ResearchResult,
  type Split,
  type SummaryDividend,
  type SummaryResearch,
  type TickerSummaryRow,
  type UpcomingRow,
} from '@marsad/core';

/** One stored `public.company_research` row, as read (parts as stored JSON). */
export interface StoredResearchRow {
  ticker: string;
  analyst: unknown;
  profile: unknown;
  calendar: unknown;
  analyst_refreshed_at: string | null;
  profile_refreshed_at: string | null;
  calendar_refreshed_at: string | null;
  errors: Record<string, string>;
}

/** One stored `public.dividends` row. */
export interface StoredDividendRow {
  ticker: string;
  exDividendDate: string;
  cashAmount: number;
  splitAdjustedCashAmount: number | null;
  currency: string;
}

/** A row as written: the core row plus the writer's clock. */
export type TickerSummaryWrite = TickerSummaryRow & { computed_at: string };

/** What the summary job reads and writes. Implemented over Supabase in ticker-summary-store.ts, by a fake in tests. */
export interface TickerSummaryStore {
  getHolidays(exchange: string): Promise<UpcomingRow[]>;
  /** Tickers of open holdings. */
  getHoldingTickers(): Promise<string[]>;
  /** Every ticker on any saved watchlist. */
  getWatchlistTickers(): Promise<string[]>;
  /** Every sector fund chosen on any watchlist item. */
  getWatchlistSectorFunds(): Promise<string[]>;
  /** Stored daily bars of one ticker, oldest first (vendor split-adjusted). */
  getDailyBars(ticker: string): Promise<DailyBar[]>;
  getResearch(tickers: readonly string[]): Promise<StoredResearchRow[]>;
  getDividends(tickers: readonly string[]): Promise<StoredDividendRow[]>;
  getSplits(tickers: readonly string[]): Promise<Split[]>;
  /** The newest stored earnings estimates (`calendar-1`), one per ticker. */
  getEarningsEstimates(): Promise<{ ticker: string; date: string }[]>;
  upsertSummaries(rows: readonly TickerSummaryWrite[]): Promise<number>;
  recordRun(run: JobRunRecord): Promise<void>;
}

export interface TickerSummaryDeps {
  store: TickerSummaryStore;
  now: () => Date;
}

/** Tickers whose dividends the study-data job fetches (STARTING_TICKERS); others read as "not fetched". */
export const DIVIDEND_TICKERS: ReadonlySet<string> = new Set(STARTING_TICKERS);

/** SPY first, then holdings, watchlists and sector funds; each ticker once, only symbols Marsad accepts. */
export function trackedTickers(...lists: readonly (readonly string[])[]): string[] {
  const out: string[] = ['SPY'];
  for (const list of lists)
    for (const raw of list) {
      const t = normalizeTicker(raw);
      if (t !== null && !out.includes(t)) out.push(t);
    }
  return out;
}

/** The stored research of one ticker, each part re-validated as the web app does; a part that fails is dropped. */
export function researchOf(row: StoredResearchRow): SummaryResearch {
  const errors: Record<string, string> = { ...row.errors };
  const part = <T>(name: string, v: unknown, check: (json: unknown) => ResearchResult<T>) => {
    if (v === null || v === undefined) return null;
    const r = check(v);
    if (r.ok) return r.value;
    errors[name] = `malformed: ${r.reason}`;
    return null;
  };
  return {
    analyst: part('analyst', row.analyst, (j) => validateAnalyst(j, row.ticker)),
    profile: part('profile', row.profile, (j) => validateProfile(j, row.ticker)),
    calendar: part('calendar', row.calendar, (j) => validateCalendar(j, row.ticker)),
    analystRefreshedAt: row.analyst_refreshed_at,
    profileRefreshedAt: row.profile_refreshed_at,
    calendarRefreshedAt: row.calendar_refreshed_at,
    errors,
  };
}

/**
 * A dividend on today's share basis: the vendor's split-adjusted amount when it gives one, otherwise the cash amount
 * times the stored splits executed after the ex-date (the same factor the bars carry).
 */
export function adjustedDividend(d: StoredDividendRow, splits: readonly Split[]): SummaryDividend {
  return {
    exDividendDate: d.exDividendDate,
    cashAmount:
      d.splitAdjustedCashAmount ?? d.cashAmount * cumulativeFactor(d.exDividendDate, splits),
    currency: d.currency,
  };
}

/**
 * The nightly ticker summary (ADR 0050): one 'tracked' row per holding, watchlist ticker, SPY and sector fund in use
 * for the last completed session, from stored data only (no vendor calls). Whole-market rows are not written
 * (ADR 0050: they would outgrow the free database). A ticker that cannot be summarised is named and the run is an
 * error, after the others are written.
 */
export async function runTickerSummaryJob(deps: TickerSummaryDeps): Promise<JobRunRecord> {
  const { store, now } = deps;
  const run = await runJob(
    'ticker-summary',
    async () => {
      const date = lastCompletedTradingDay(now(), buildCalendar(await store.getHolidays('NYSE')));
      if (date === null)
        throw new Error('No completed trading day found, so no session to summarise');
      const base = trackedTickers(
        await store.getHoldingTickers(),
        await store.getWatchlistTickers(),
        await store.getWatchlistSectorFunds(),
      );
      const research = new Map<string, SummaryResearch>();
      for (const r of await store.getResearch(base)) research.set(r.ticker, researchOf(r));
      // The sector fund of each tracked company (from its GICS sector) is tracked too, so its row exists.
      const draft = new Map<string, TickerSummaryRow>();
      const bars = new Map<string, DailyBar[]>();
      const spy = await store.getDailyBars('SPY');
      bars.set('SPY', spy);
      const dividendRows = await store.getDividends(base.filter((t) => DIVIDEND_TICKERS.has(t)));
      const splits = await store.getSplits(base);
      const estimates = new Map((await store.getEarningsEstimates()).map((e) => [e.ticker, e]));
      const failed: string[] = [];
      const summarise = async (ticker: string) => {
        try {
          const b = bars.get(ticker) ?? (await store.getDailyBars(ticker));
          bars.set(ticker, b);
          const own = splits.filter((s) => s.ticker === ticker);
          draft.set(
            ticker,
            tickerDailySummary({
              ticker,
              date,
              coverage: 'tracked',
              bars: b,
              spy,
              research: research.get(ticker) ?? null,
              dividends: DIVIDEND_TICKERS.has(ticker)
                ? dividendRows
                    .filter((d) => d.ticker === ticker)
                    .map((d) => adjustedDividend(d, own))
                : null,
              earningsEstimate: estimates.get(ticker) ?? null,
            }),
          );
        } catch (e) {
          failed.push(`${ticker}: ${e instanceof Error ? e.message : String(e)}`);
        }
      };
      for (const t of base) await summarise(t);
      const funds = [...draft.values()]
        .map((r) => r.sector_etf)
        .filter((f): f is string => f !== null && !draft.has(f));
      for (const f of [...new Set(funds)]) await summarise(f);

      const at = now().toISOString();
      const rows = [...draft.values()].map((r) => ({ ...r, computed_at: at }));
      const written = await store.upsertSummaries(rows);
      const noBars = rows.filter((r) => r.close === null).map((r) => r.ticker);
      const stale = rows
        .filter((r) => r.close_date !== null && r.close_date < date)
        .map((r) => `${r.ticker} (${r.close_date})`);
      if (failed.length > 0)
        throw new Error(
          `Ticker summary: ${written} rows written, then failed: ${failed.join('; ')}`.slice(
            0,
            480,
          ),
        );
      return {
        rows: written,
        details: {
          version: TICKER_SUMMARY_VERSION,
          date,
          tracked: rows.length,
          market: 0,
          marketNote: 'whole-market rows not written (ADR 0050: database size on the free plan)',
          withResearch: rows.filter((r) => r.sources['research']).length,
          withDividends: rows.filter((r) => r.dividends_ttm !== null).length,
          noBars,
          stale,
        },
      };
    },
    () => now().getTime(),
  );
  await store.recordRun(run);
  return run;
}
