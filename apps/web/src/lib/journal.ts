import type { DailyBar, Holding } from '@marsad/core';
import { supabase } from './supabase';

function client() {
  if (!supabase) throw new Error('not configured');
  return supabase;
}

export interface StoredHolding extends Holding {
  id: number;
}

/** Open holdings and the last year of bars for each ticker. Reads go through row-level security. */
export async function loadHoldings(): Promise<{
  holdings: StoredHolding[];
  bars: Record<string, DailyBar[]>;
}> {
  const r = await client()
    .from('holdings')
    .select(
      'id, ticker, shares, cost_basis, opened_on, stop, targets, trend_break, time_stop_sessions',
    )
    .is('closed_on', null)
    .order('opened_on', { ascending: true });
  if (r.error) throw new Error(`holdings: ${r.error.message}`);
  const holdings: StoredHolding[] = ((r.data ?? []) as Record<string, unknown>[]).map((x) => {
    const tb = /^(sma|ema)(\d+)$/.exec(String(x['trend_break'] ?? ''));
    return {
      id: Number(x['id']),
      ticker: String(x['ticker']),
      shares: Number(x['shares']),
      costBasis: Number(x['cost_basis']),
      openedOn: String(x['opened_on']),
      stop: x['stop'] === null ? null : Number(x['stop']),
      targets: ((x['targets'] ?? []) as unknown[]).map(Number),
      trendBreak: tb ? { ind: tb[1] as 'sma' | 'ema', period: Number(tb[2]) } : null,
      timeStopSessions: x['time_stop_sessions'] === null ? null : Number(x['time_stop_sessions']),
    };
  });
  const bars: Record<string, DailyBar[]> = {};
  await Promise.all(
    [...new Set(holdings.map((h) => h.ticker))].map(async (t) => {
      const b = await client()
        .from('daily_bars')
        .select('date, open, high, low, close, volume, vwap')
        .eq('ticker', t)
        .order('date', { ascending: false })
        .limit(260);
      if (b.error) throw new Error(`daily_bars ${t}: ${b.error.message}`);
      bars[t] = ((b.data ?? []) as Record<string, unknown>[])
        .map((y) => ({
          date: String(y['date']),
          open: Number(y['open']),
          high: Number(y['high']),
          low: Number(y['low']),
          close: Number(y['close']),
          volume: Number(y['volume']),
          vwap: y['vwap'] === null ? null : Number(y['vwap']),
        }))
        .reverse();
    }),
  );
  return { holdings, bars };
}

/** Adds holdings (from the form or a CSV). */
export async function addHoldings(rows: readonly Holding[]): Promise<void> {
  const r = await client()
    .from('holdings')
    .insert(
      rows.map((h) => ({
        ticker: h.ticker,
        shares: h.shares,
        cost_basis: h.costBasis,
        opened_on: h.openedOn,
        stop: h.stop,
        targets: h.targets,
        trend_break: h.trendBreak ? `${h.trendBreak.ind}${h.trendBreak.period}` : null,
        time_stop_sessions: h.timeStopSessions,
      })),
    );
  if (r.error) throw new Error(`holdings: ${r.error.message}`);
}

/** Marks a holding closed today (it stays in history). */
export async function closeHolding(id: number, on: string): Promise<void> {
  const r = await client().from('holdings').update({ closed_on: on }).eq('id', id);
  if (r.error) throw new Error(`holdings: ${r.error.message}`);
}
