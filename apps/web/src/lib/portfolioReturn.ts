/**
 * Stored closes behind "Your actual result" (core `portfolio-return-1`): every traded ticker and SPY, from the
 * first trade date to the newest stored session, oldest first. Reads go through row-level security; a long
 * history is read in pages of PostgREST's row cap.
 */
import type { DailyBar } from '@marsad/core';
import { supabase } from './supabase';

function client() {
  if (!supabase) throw new Error('not configured');
  return supabase;
}

const PAGE = 1000;

async function closesOf(ticker: string, from: string): Promise<DailyBar[]> {
  const out: DailyBar[] = [];
  for (let page = 0; page < 20; page += 1) {
    const r = await client()
      .from('daily_bars')
      .select('date, open, high, low, close, volume, vwap')
      .eq('ticker', ticker)
      .gte('date', from)
      .order('date', { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (r.error) throw new Error(`daily_bars ${ticker}: ${r.error.message}`);
    const rows = (r.data ?? []) as Record<string, unknown>[];
    for (const x of rows)
      out.push({
        date: String(x['date']),
        open: Number(x['open']),
        high: Number(x['high']),
        low: Number(x['low']),
        close: Number(x['close']),
        volume: Number(x['volume']),
        vwap: x['vwap'] === null || x['vwap'] === undefined ? null : Number(x['vwap']),
      });
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Closes of each ticker and SPY since `from` (inclusive). */
export async function loadTradeCloses(
  tickers: readonly string[],
  from: string,
): Promise<{ closes: Record<string, DailyBar[]>; spy: DailyBar[] }> {
  const list = [...new Set(tickers)].filter((t) => t !== 'SPY');
  const [spy, ...lists] = await Promise.all([
    closesOf('SPY', from),
    ...list.map((t) => closesOf(t, from)),
  ]);
  const closes: Record<string, DailyBar[]> = { SPY: spy ?? [] };
  list.forEach((t, i) => (closes[t] = lists[i] ?? []));
  return { closes, spy: spy ?? [] };
}
