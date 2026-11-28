/**
 * The nightly per-ticker summary (`ticker_daily_summary`, `ticker-summary-1`, ADR 0050) for the pages that list
 * tickers: Watch rows, the quick look and Portfolio's column sets (ADR 0048 batch 4).
 *
 * One REST read gives the newest row of each ticker. A page uses the row when it is current, that is when its
 * `close_date` is not older than the newest bar the page holds for that ticker; otherwise it computes the same row
 * from its bars with core's `tickerDailySummary` (the function the job runs), and says which it did. Reads go
 * through row-level security: members read 'tracked' rows, the owner also 'market' rows.
 */
import {
  SUMMARY_FIELDS,
  TICKER_SUMMARY_VERSION,
  tickerDailySummary,
  type DailyBar,
  type SummaryCoverage,
  type TickerSummaryRow,
} from '@marsad/core';
import { supabase } from './supabase';

function client() {
  if (!supabase) throw new Error('not configured');
  return supabase;
}

/** A stored row: the job's figures plus when it wrote them. */
export type StoredSummary = TickerSummaryRow & { computed_at: string };

/** Rows read per ticker at most: a week of sessions, so a ticker one run behind still has its newest row. */
const ROWS_PER_TICKER = 7;
/** PostgREST's row cap on this project (`supabase/config.toml` `max_rows`). */
const MAX_ROWS = 1000;

const TEXT_FIELDS: ReadonlySet<string> = new Set([
  'close_date',
  'next_earnings_date',
  'next_earnings_source',
  'analyst_recommendation',
  'sector_etf',
]);
const BOOL_FIELDS: ReadonlySet<string> = new Set(['above_sma_50', 'above_sma_200']);

/** One stored row in core's shape: numbers as numbers (numeric columns can arrive as text), nulls kept. */
export function toSummary(x: Record<string, unknown>): StoredSummary {
  const row: Record<string, unknown> = {
    version: String(x['version']),
    date: String(x['date']),
    ticker: String(x['ticker']),
    coverage: (x['coverage'] === 'market' ? 'market' : 'tracked') as SummaryCoverage,
    unavailable: (x['unavailable'] ?? {}) as Record<string, string>,
    sources: (x['sources'] ?? {}) as Record<string, Record<string, unknown>>,
    formula_versions: (x['formula_versions'] ?? {}) as Record<string, string>,
    computed_at: String(x['computed_at']),
  };
  for (const k of SUMMARY_FIELDS) {
    const v = x[k];
    if (v === null || v === undefined) row[k] = null;
    else if (TEXT_FIELDS.has(k)) row[k] = String(v);
    else if (BOOL_FIELDS.has(k)) row[k] = v === true || v === 'true';
    else {
      const n = Number(v);
      row[k] = Number.isFinite(n) ? n : null;
    }
  }
  return row as unknown as StoredSummary;
}

/**
 * The newest `ticker-summary-1` row of each ticker, in one read per 140 tickers (newest date first, the first row
 * per ticker wins). A ticker with no row is absent from the result.
 */
export async function loadSummaries(
  tickers: readonly string[],
): Promise<Record<string, StoredSummary>> {
  const list = [...new Set(tickers)].sort();
  const out: Record<string, StoredSummary> = {};
  const per = Math.floor(MAX_ROWS / ROWS_PER_TICKER);
  for (let i = 0; i < list.length; i += per) {
    const chunk = list.slice(i, i + per);
    const r = await client()
      .from('ticker_daily_summary')
      .select('*')
      .eq('version', TICKER_SUMMARY_VERSION)
      .in('ticker', chunk)
      .order('date', { ascending: false })
      .limit(chunk.length * ROWS_PER_TICKER);
    if (r.error) throw new Error(`ticker_daily_summary: ${r.error.message}`);
    for (const x of (r.data ?? []) as Record<string, unknown>[]) {
      const tk = String(x['ticker']);
      if (!out[tk]) out[tk] = toSummary(x);
    }
  }
  return out;
}

/** Where a page's figures for one ticker came from. */
export type FiguresFrom =
  | { kind: 'summary'; date: string; computedAt: string }
  | { kind: 'bars'; why: 'missing' | 'stale' };

export interface Figures {
  row: TickerSummaryRow;
  from: FiguresFrom;
}

/** True when the stored row is as new as the newest bar the page holds (or the page holds none). */
export function isCurrent(row: StoredSummary | undefined, bars: readonly DailyBar[]): boolean {
  if (!row || row.close_date === null) return false;
  const newest = bars.at(-1)?.date;
  return newest === undefined || row.close_date >= newest;
}

/**
 * The summary figures of one ticker: the stored row when it is current, else the same row computed from the
 * page's bars (prices and indicators only: research, dividends and the stated results date need the job's
 * inputs, so they show as unavailable with that reason). `estimate` is Marsad's estimated results date, used
 * only in the bar computation, as the job does.
 */
export function figuresOf(
  ticker: string,
  stored: StoredSummary | undefined,
  bars: readonly DailyBar[],
  spy: readonly DailyBar[] | null,
  estimate: { date: string } | null = null,
): Figures {
  if (stored && isCurrent(stored, bars))
    return {
      row: stored,
      from: { kind: 'summary', date: stored.date, computedAt: stored.computed_at },
    };
  const date = bars.at(-1)?.date ?? stored?.date ?? '';
  return {
    row: tickerDailySummary({
      ticker,
      date,
      coverage: 'tracked',
      bars,
      spy,
      research: null,
      dividends: null,
      earningsEstimate: estimate,
    }),
    from: { kind: 'bars', why: stored ? 'stale' : 'missing' },
  };
}

/** Recent bars of several tickers in batched reads (oldest first per ticker), each read within the row cap. */
export async function loadBarsBatch(
  tickers: readonly string[],
  sessions: number,
): Promise<Record<string, DailyBar[]>> {
  const list = [...new Set(tickers)].sort();
  // Ten spare rows per ticker cover a ticker that misses a session the others have.
  const per = Math.max(1, Math.floor(MAX_ROWS / (sessions + 10)));
  const out: Record<string, DailyBar[]> = {};
  const chunks: string[][] = [];
  for (let i = 0; i < list.length; i += per) chunks.push(list.slice(i, i + per));
  const results = await Promise.all(
    chunks.map((chunk) =>
      client()
        .from('daily_bars')
        .select('ticker, date, open, high, low, close, volume, vwap')
        .in('ticker', chunk)
        .order('date', { ascending: false })
        .limit(chunk.length * (sessions + 10)),
    ),
  );
  // A read that filled its limit may have cut a ticker short (one with gaps the others do not have).
  const recheck: string[] = [];
  results.forEach((r, i) => {
    if (r.error) throw new Error(`daily_bars: ${r.error.message}`);
    const rows = (r.data ?? []) as Record<string, unknown>[];
    for (const x of rows) {
      if (typeof x['ticker'] !== 'string') continue;
      const own = (out[x['ticker']] ??= []);
      if (own.length < sessions) own.push(barOf(x));
    }
    const chunk = chunks[i] ?? [];
    if (rows.length >= chunk.length * (sessions + 10))
      recheck.push(...chunk.filter((tk) => (out[tk]?.length ?? 0) < sessions));
  });
  for (const k of Object.keys(out)) out[k]?.reverse();
  await Promise.all(
    recheck.map(async (tk) => {
      const r = await client()
        .from('daily_bars')
        .select('date, open, high, low, close, volume, vwap')
        .eq('ticker', tk)
        .order('date', { ascending: false })
        .limit(sessions);
      if (r.error) throw new Error(`daily_bars ${tk}: ${r.error.message}`);
      out[tk] = ((r.data ?? []) as Record<string, unknown>[]).map(barOf).reverse();
    }),
  );
  return out;
}

function barOf(x: Record<string, unknown>): DailyBar {
  return {
    date: String(x['date']),
    open: Number(x['open']),
    high: Number(x['high']),
    low: Number(x['low']),
    close: Number(x['close']),
    volume: Number(x['volume']),
    vwap: x['vwap'] === null || x['vwap'] === undefined ? null : Number(x['vwap']),
  };
}
