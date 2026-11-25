import type { DailyBar, DatedValue, Holding, ThesisStatus } from '@marsad/core';
import { supabase } from './supabase';

function client() {
  if (!supabase) throw new Error('not configured');
  return supabase;
}

export interface StoredHolding extends Holding {
  id: number;
  sectorEtf: string | null;
  thesisStatus: ThesisStatus;
}

/** Bars per ticker (oldest first): every holding, SPY and the assigned sector ETFs. */
export type BarsByTicker = Record<string, DailyBar[]>;

async function loadBars(ticker: string): Promise<DailyBar[]> {
  const b = await client()
    .from('daily_bars')
    .select('date, open, high, low, close, volume, vwap')
    .eq('ticker', ticker)
    .order('date', { ascending: false })
    .limit(300);
  if (b.error) throw new Error(`daily_bars ${ticker}: ${b.error.message}`);
  return ((b.data ?? []) as Record<string, unknown>[])
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
}

/**
 * Open holdings, about 300 sessions of bars for each holding, SPY and every assigned sector ETF (enough for a
 * 252-session beta), and the VIX closes for the same span. Reads go through row-level security.
 */
export async function loadHoldings(): Promise<{
  holdings: StoredHolding[];
  bars: BarsByTicker;
  vix: DatedValue[];
}> {
  const r = await client()
    .from('holdings')
    .select(
      'id, ticker, shares, cost_basis, opened_on, stop, targets, trend_break, time_stop_sessions, sector_etf, thesis_status',
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
      sectorEtf: x['sector_etf'] === null ? null : String(x['sector_etf']),
      thesisStatus: (x['thesis_status'] ?? 'intact') as ThesisStatus,
    };
  });
  const bars: BarsByTicker = {};
  const tickers = new Set(['SPY', ...holdings.map((h) => h.ticker)]);
  for (const h of holdings) if (h.sectorEtf) tickers.add(h.sectorEtf);
  const vixQuery = client()
    .from('fred_observations')
    .select('date, value')
    .eq('series_id', 'VIXCLS')
    .order('date', { ascending: false })
    .limit(320);
  const [, v] = await Promise.all([
    Promise.all(
      [...tickers].map(async (t) => {
        bars[t] = await loadBars(t);
      }),
    ),
    holdings.length > 0 ? vixQuery : Promise.resolve({ data: [], error: null }),
  ]);
  if (v.error) throw new Error(`fred_observations VIXCLS: ${v.error.message}`);
  const vix = ((v.data ?? []) as Record<string, unknown>[])
    .filter((y) => y['value'] !== null)
    .map((y) => ({ date: String(y['date']), value: Number(y['value']) }))
    .reverse();
  return { holdings, bars, vix };
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

/** Sets a holding's sector ETF and thesis status (the owner's call, never inferred). */
export async function updateHoldingMeta(
  id: number,
  meta: { sectorEtf: string | null; thesisStatus: ThesisStatus },
): Promise<void> {
  const r = await client()
    .from('holdings')
    .update({ sector_etf: meta.sectorEtf, thesis_status: meta.thesisStatus })
    .eq('id', id);
  if (r.error) throw new Error(`holdings: ${r.error.message}`);
}
