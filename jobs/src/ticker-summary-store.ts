import { createClient } from '@supabase/supabase-js';
import { supabaseStore } from './store.js';
import type { TickerSummaryStore } from './ticker-summary-job.js';

/** Rows per upsert call: a summary row is about 2 KB with its JSON, so 200 rows stay well under request limits. */
const CHUNK = 200;

/** The ticker summary job's reads and writes with the secret key (ADR 0050). */
export function supabaseTickerSummaryStore(url: string, secretKey: string): TickerSummaryStore {
  const db = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const main = supabaseStore(url, secretKey);
  return {
    getHolidays: (exchange) => main.getHolidays(exchange),
    getWatchlistTickers: () => main.getWatchlistTickers(),
    getDailyBars: (ticker) => main.getDailyBars(ticker),
    recordRun: (run) => main.recordRun(run),
    async getHoldingTickers() {
      return [...new Set((await main.getOpenHoldings()).map((h) => h.ticker))];
    },
    async getWatchlistSectorFunds() {
      const { data, error } = await db
        .from('watchlist_items')
        .select('sector_etf')
        .not('sector_etf', 'is', null)
        .limit(1000);
      if (error) throw new Error(`watchlist_items read failed: ${error.message}`);
      return [...new Set((data ?? []).map((r) => String(r.sector_etf)))];
    },
    async getResearch(tickers) {
      if (tickers.length === 0) return [];
      const { data, error } = await db
        .from('company_research')
        .select(
          'ticker, analyst, profile, calendar, analyst_refreshed_at, profile_refreshed_at, calendar_refreshed_at, errors',
        )
        .in('ticker', [...tickers]);
      if (error) throw new Error(`company_research read failed: ${error.message}`);
      return (data ?? []).map((r) => ({
        ticker: String(r.ticker),
        analyst: r.analyst as unknown,
        profile: r.profile as unknown,
        calendar: r.calendar as unknown,
        analyst_refreshed_at: (r.analyst_refreshed_at as string | null) ?? null,
        profile_refreshed_at: (r.profile_refreshed_at as string | null) ?? null,
        calendar_refreshed_at: (r.calendar_refreshed_at as string | null) ?? null,
        errors: (r.errors ?? {}) as Record<string, string>,
      }));
    },
    async getDividends(tickers) {
      if (tickers.length === 0) return [];
      const { data, error } = await db
        .from('dividends')
        .select('ticker, ex_dividend_date, cash_amount, split_adjusted_cash_amount, currency')
        .in('ticker', [...tickers])
        .order('ex_dividend_date', { ascending: true })
        .limit(5000);
      if (error) throw new Error(`dividends read failed: ${error.message}`);
      return (data ?? []).map((r) => ({
        ticker: String(r.ticker),
        exDividendDate: String(r.ex_dividend_date),
        cashAmount: Number(r.cash_amount),
        splitAdjustedCashAmount:
          r.split_adjusted_cash_amount === null ? null : Number(r.split_adjusted_cash_amount),
        currency: String(r.currency),
      }));
    },
    async getSplits(tickers) {
      if (tickers.length === 0) return [];
      const { data, error } = await db
        .from('splits')
        .select('ticker, execution_date, split_from, split_to, adjustment_type')
        .in('ticker', [...tickers])
        .limit(5000);
      if (error) throw new Error(`splits read failed: ${error.message}`);
      return (data ?? []).map((r) => ({
        ticker: String(r.ticker),
        executionDate: String(r.execution_date),
        splitFrom: Number(r.split_from),
        splitTo: Number(r.split_to),
        adjustmentType: String(r.adjustment_type),
      }));
    },
    async getEarningsEstimates() {
      const { data, error } = await db
        .from('earnings_estimate_snapshots')
        .select('estimates')
        .order('computed_at', { ascending: false })
        .limit(1);
      if (error) throw new Error(`earnings_estimate_snapshots read failed: ${error.message}`);
      const list = ((data ?? [])[0]?.estimates ?? []) as { ticker?: unknown; date?: unknown }[];
      return list
        .filter((e) => typeof e.ticker === 'string' && typeof e.date === 'string')
        .map((e) => ({ ticker: e.ticker as string, date: e.date as string }));
    },
    async upsertSummaries(rows) {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error } = await db
          .from('ticker_daily_summary')
          .upsert(rows.slice(i, i + CHUNK), { onConflict: 'version,date,ticker' });
        if (error) throw new Error(`ticker_daily_summary upsert failed: ${error.message}`);
      }
      return rows.length;
    },
  };
}
