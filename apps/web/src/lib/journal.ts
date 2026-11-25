import {
  SCREENSHOTS_PER_TRADE,
  SCREENSHOT_MAX_BYTES,
  SCREENSHOT_TYPES,
  screenshotPath,
  type DailyBar,
  type DatedValue,
  type Holding,
  type JournalTrade,
  type ThesisStatus,
} from '@marsad/core';
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

function toTrade(x: Record<string, unknown>): JournalTrade {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: Number(x['id']),
    ticker: String(x['ticker']),
    side: x['side'] === 'short' ? 'short' : 'long',
    setup: String(x['setup'] ?? ''),
    tags: (x['tags'] ?? []) as string[],
    alertId: x['alert_id'] === null ? null : String(x['alert_id']),
    entryDate: String(x['entry_date']),
    entryPrice: Number(x['entry_price']),
    shares: Number(x['shares']),
    stop: n(x['stop']),
    target: n(x['target']),
    exitDate: x['exit_date'] === null ? null : String(x['exit_date']),
    exitPrice: n(x['exit_price']),
    checklist: (x['checklist'] ?? {}) as JournalTrade['checklist'],
    followed: (x['followed'] ?? {}) as JournalTrade['followed'],
    notes: String(x['notes'] ?? ''),
    screenshots: (x['screenshots'] ?? []) as string[],
  };
}

/** Trades, newest entry first, and the last 30 days of delivered alerts to link them to. */
export async function loadTrades(): Promise<{
  trades: JournalTrade[];
  alerts: { id: string; ticker: string | null; headline: string; createdAt: string }[];
}> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [t, a] = await Promise.all([
    client().from('trades').select('*').order('entry_date', { ascending: false }).limit(500),
    client()
      .from('alerts')
      .select('id, ticker, headline, created_at')
      .neq('decision', 'suppress')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(200),
  ]);
  if (t.error) throw new Error(`trades: ${t.error.message}`);
  if (a.error) throw new Error(`alerts: ${a.error.message}`);
  return {
    trades: ((t.data ?? []) as Record<string, unknown>[]).map(toTrade),
    alerts: ((a.data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: String(r['id']),
      ticker: r['ticker'] === null ? null : String(r['ticker']),
      headline: String(r['headline']),
      createdAt: String(r['created_at']),
    })),
  };
}

export type NewTrade = Omit<JournalTrade, 'id' | 'exitDate' | 'exitPrice' | 'screenshots'>;

export async function addTrade(x: NewTrade): Promise<void> {
  const r = await client().from('trades').insert({
    ticker: x.ticker,
    side: x.side,
    setup: x.setup,
    tags: x.tags,
    alert_id: x.alertId,
    entry_date: x.entryDate,
    entry_price: x.entryPrice,
    shares: x.shares,
    stop: x.stop,
    target: x.target,
    checklist: x.checklist,
    followed: x.followed,
    notes: x.notes,
  });
  if (r.error) throw new Error(`trades: ${r.error.message}`);
}

/** Records the exit and whether it followed the plan. */
export async function closeTrade(
  t: JournalTrade,
  exit: { date: string; price: number; exitedPerPlan: boolean },
): Promise<void> {
  const r = await client()
    .from('trades')
    .update({
      exit_date: exit.date,
      exit_price: exit.price,
      followed: { ...t.followed, exitedPerPlan: exit.exitedPerPlan },
      updated_at: new Date().toISOString(),
    })
    .eq('id', t.id);
  if (r.error) throw new Error(`trades: ${r.error.message}`);
}

/** Uploads a screenshot to the private bucket under the owner's folder, then lists it on the trade. */
export async function addScreenshot(t: JournalTrade, file: File): Promise<void> {
  if (!(SCREENSHOT_TYPES as readonly string[]).includes(file.type))
    throw new Error('Use a PNG, JPEG or WebP image.');
  if (file.size > SCREENSHOT_MAX_BYTES) throw new Error('Images can be at most 5 MB.');
  if (t.screenshots.length >= SCREENSHOTS_PER_TRADE)
    throw new Error(`At most ${SCREENSHOTS_PER_TRADE} screenshots a trade.`);
  const { data: user, error: ue } = await client().auth.getUser();
  if (ue || !user.user) throw new Error('Not signed in.');
  const path = screenshotPath(user.user.id, t.id, t.screenshots.length + 1, file.type);
  const up = await client()
    .storage.from('journal')
    .upload(path, file, { contentType: file.type, upsert: true });
  if (up.error) throw new Error(`screenshot: ${up.error.message}`);
  const r = await client()
    .from('trades')
    .update({ screenshots: [...t.screenshots, path], updated_at: new Date().toISOString() })
    .eq('id', t.id);
  if (r.error) throw new Error(`trades: ${r.error.message}`);
}

/** A screenshot as a local object URL (the bucket is private; the page's policy allows blob: images). */
export async function screenshotUrl(path: string): Promise<string> {
  const r = await client().storage.from('journal').download(path);
  if (r.error) throw new Error(`screenshot: ${r.error.message}`);
  return URL.createObjectURL(r.data);
}

/** The newest weekly review (a brief of kind weekly-review), or null before the first Sunday run. */
export async function loadWeeklyReview(): Promise<{
  title: string;
  forDate: string;
  sections: { heading: string; lines: string[] }[];
} | null> {
  const r = await client()
    .from('briefs')
    .select('title, for_date, sections')
    .eq('kind', 'weekly-review')
    .order('for_date', { ascending: false })
    .limit(1);
  if (r.error) throw new Error(`briefs: ${r.error.message}`);
  const x = ((r.data ?? []) as Record<string, unknown>[])[0];
  return x
    ? {
        title: String(x['title']),
        forDate: String(x['for_date']),
        sections: (x['sections'] ?? []) as { heading: string; lines: string[] }[],
      }
    : null;
}
