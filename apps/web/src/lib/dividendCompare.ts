/**
 * Reads behind Portfolio's "Compare dividend returns" (core `dividend-compare-1`): which candidate tickers paid a
 * dividend in the last year, and for each chosen ticker its stored bars (enough for the 3-year historical return),
 * its stored dividends and its splits. Every read goes through row-level security.
 */
import { HISTORICAL_SESSIONS, type DailyBar, type Split, type StoredDividend } from '@marsad/core';
import { supabase } from './supabase';
import { loadDividendHistory } from './research';

function client() {
  if (!supabase) throw new Error('not configured');
  return supabase;
}

/** Bars read per ticker: the 3-year window plus its first close, with room for a missed session. */
export const COMPARE_BARS = HISTORICAL_SESSIONS.y3 + 40;

/** The candidates with a stored ex-dividend date in the 365 days to `today`, in the order given. */
export async function loadDividendPayers(
  tickers: readonly string[],
  today: string,
): Promise<string[]> {
  if (tickers.length === 0) return [];
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 365 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const r = await client()
    .from('dividends')
    .select('ticker')
    .in('ticker', [...tickers])
    .gte('ex_dividend_date', since)
    .lte('ex_dividend_date', today)
    .limit(1000);
  if (r.error) throw new Error(`dividends: ${r.error.message}`);
  const paid = new Set(((r.data ?? []) as { ticker: string }[]).map((x) => x.ticker));
  return tickers.filter((tk) => paid.has(tk));
}

export interface CompareInputs {
  bars: DailyBar[];
  dividends: StoredDividend[];
  splits: Split[];
}

/** One ticker's stored bars (oldest first), dividends and splits. */
export async function loadCompareInputs(ticker: string): Promise<CompareInputs> {
  const [b, dividends, s] = await Promise.all([
    client()
      .from('daily_bars')
      .select('date, open, high, low, close, volume, vwap')
      .eq('ticker', ticker)
      .order('date', { ascending: false })
      .limit(COMPARE_BARS),
    loadDividendHistory(ticker),
    client()
      .from('splits')
      .select('ticker, execution_date, split_from, split_to, adjustment_type')
      .eq('ticker', ticker)
      .limit(100),
  ]);
  if (b.error) throw new Error(`daily_bars ${ticker}: ${b.error.message}`);
  if (s.error) throw new Error(`splits: ${s.error.message}`);
  const bars = ((b.data ?? []) as Record<string, unknown>[])
    .map((x) => ({
      date: String(x['date']),
      open: Number(x['open']),
      high: Number(x['high']),
      low: Number(x['low']),
      close: Number(x['close']),
      volume: Number(x['volume']),
      vwap: x['vwap'] === null || x['vwap'] === undefined ? null : Number(x['vwap']),
    }))
    .reverse();
  const splits = ((s.data ?? []) as Record<string, unknown>[]).map((x) => ({
    ticker: String(x['ticker']),
    executionDate: String(x['execution_date']),
    splitFrom: Number(x['split_from']),
    splitTo: Number(x['split_to']),
    adjustmentType: String(x['adjustment_type']),
  }));
  return { bars, dividends, splits };
}

/** One CSV field: quoted when it holds a comma, a quote or a line break. */
export const csvCell = (v: string | number | null): string => {
  const s = v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
