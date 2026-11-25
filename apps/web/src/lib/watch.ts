import {
  CORE_ETFS,
  STARTING_TICKERS,
  type DailyBar,
  type EarningsEstimate,
  type EconEvent,
  type MarketMovers,
  type NewsItem,
  type Obs,
} from '@marsad/core';
import { supabase } from './supabase';

function client() {
  if (!supabase) throw new Error('not configured');
  return supabase;
}

export interface StoredEstimate extends EarningsEstimate {
  ticker: string;
  cik: string;
}

export interface CalendarData {
  /** The newest calendar snapshot, or null before the first run. */
  econ: { fetchedAt: string; version: string; events: EconEvent[] } | null;
  earnings: { computedAt: string; estimates: StoredEstimate[] } | null;
}

/** The newest economic-calendar and earnings-estimate snapshots. Every read goes through row-level security. */
export async function loadCalendar(): Promise<CalendarData> {
  const [econR, earnR] = await Promise.all([
    client()
      .from('econ_calendar_snapshots')
      .select('*')
      .order('fetched_at', { ascending: false })
      .limit(1),
    client()
      .from('earnings_estimate_snapshots')
      .select('*')
      .order('computed_at', { ascending: false })
      .limit(1),
  ]);
  if (econR.error) throw new Error(`econ_calendar_snapshots: ${econR.error.message}`);
  if (earnR.error) throw new Error(`earnings_estimate_snapshots: ${earnR.error.message}`);
  const e = (econR.data ?? [])[0] as Record<string, unknown> | undefined;
  const g = (earnR.data ?? [])[0] as Record<string, unknown> | undefined;
  return {
    econ: e
      ? {
          fetchedAt: String(e['fetched_at']),
          version: String(e['version']),
          events: (e['events'] ?? []) as EconEvent[],
        }
      : null,
    earnings: g
      ? {
          computedAt: String(g['computed_at']),
          estimates: (g['estimates'] ?? []) as StoredEstimate[],
        }
      : null,
  };
}

/** Strip tickers beyond the core ETFs: gold, as a daily bar. */
export const STRIP_BARS = [...CORE_ETFS, 'GLD'] as const;
/** FRED series in the strip. */
export const STRIP_SERIES = ['VIXCLS', 'DGS10', 'DCOILWTICO', 'DTWEXBGS'] as const;

export interface WatchData {
  tickers: string[];
  /** The watchlist came from the starting list (no saved watchlist yet). */
  defaultList: boolean;
  bars: Record<string, DailyBar[]>;
  series: Record<string, Obs[]>;
  movers: MarketMovers | null;
  news: NewsItem[];
}

const num = (v: unknown): number => Number(v);

async function barsOf(ticker: string): Promise<DailyBar[]> {
  const r = await client()
    .from('daily_bars')
    .select('date, open, high, low, close, volume, vwap')
    .eq('ticker', ticker)
    .order('date', { ascending: false })
    .limit(260);
  if (r.error) throw new Error(`daily_bars ${ticker}: ${r.error.message}`);
  return ((r.data ?? []) as Record<string, unknown>[])
    .map((x) => ({
      date: String(x['date']),
      open: num(x['open']),
      high: num(x['high']),
      low: num(x['low']),
      close: num(x['close']),
      volume: num(x['volume']),
      vwap: x['vwap'] === null ? null : num(x['vwap']),
    }))
    .reverse();
}

async function seriesOf(id: string): Promise<Obs[]> {
  const r = await client()
    .from('fred_observations')
    .select('date, value')
    .eq('series_id', id)
    .not('value', 'is', null)
    .order('date', { ascending: false })
    .limit(30);
  if (r.error) throw new Error(`fred_observations ${id}: ${r.error.message}`);
  return ((r.data ?? []) as Record<string, unknown>[])
    .map((x) => ({ date: String(x['date']), value: num(x['value']) }))
    .reverse();
}

/** Everything the Watch dashboard shows besides the calendars. Every read goes through row-level security. */
export async function loadWatch(): Promise<WatchData> {
  const items = await client()
    .from('watchlist_items')
    .select('ticker, position')
    .order('position', { ascending: true })
    .limit(100);
  if (items.error) throw new Error(`watchlist_items: ${items.error.message}`);
  const saved = [...new Set(((items.data ?? []) as { ticker: string }[]).map((x) => x.ticker))];
  const tickers = saved.length > 0 ? saved : [...STARTING_TICKERS];
  const barTickers = [...new Set([...tickers, ...STRIP_BARS])];
  const [barLists, seriesLists, moversR, newsR] = await Promise.all([
    Promise.all(barTickers.map((t) => barsOf(t))),
    Promise.all(STRIP_SERIES.map((id) => seriesOf(id))),
    client().from('market_movers_daily').select('*').order('date', { ascending: false }).limit(1),
    client()
      .from('news_articles')
      .select('id, published_at, publisher, title, url, tickers')
      .overlaps('tickers', tickers)
      .order('published_at', { ascending: false })
      .limit(80),
  ]);
  if (moversR.error) throw new Error(`market_movers_daily: ${moversR.error.message}`);
  if (newsR.error) throw new Error(`news_articles: ${newsR.error.message}`);
  const bars: Record<string, DailyBar[]> = {};
  barTickers.forEach((t, i) => (bars[t] = barLists[i] ?? []));
  const series: Record<string, Obs[]> = {};
  STRIP_SERIES.forEach((id, i) => (series[id] = seriesLists[i] ?? []));
  const m = (moversR.data ?? [])[0] as Record<string, unknown> | undefined;
  return {
    tickers,
    defaultList: saved.length === 0,
    bars,
    series,
    movers: m
      ? {
          date: String(m['date']),
          version: String(m['version']),
          n: num(m['n']),
          gainers: m['gainers'] as MarketMovers['gainers'],
          losers: m['losers'] as MarketMovers['losers'],
          sectors: m['sectors'] as MarketMovers['sectors'],
        }
      : null,
    news: ((newsR.data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: String(r['id']),
      publisher: String(r['publisher']),
      title: String(r['title']),
      publishedAt: new Date(String(r['published_at'])).toISOString(),
      url: String(r['url']),
      tickers: Array.isArray(r['tickers']) ? (r['tickers'] as string[]) : [],
    })),
  };
}

export interface StoredBrief {
  kind: string;
  forDate: string;
  title: string;
  sections: { heading: string; lines: string[] }[];
  delivery: Record<string, string>;
  createdAt: string;
}

/** The two newest briefs (pre-market and recap). */
export async function loadBriefs(): Promise<StoredBrief[]> {
  const r = await client()
    .from('briefs')
    .select('kind, for_date, title, sections, delivery, created_at')
    .order('created_at', { ascending: false })
    .limit(2);
  if (r.error) throw new Error(`briefs: ${r.error.message}`);
  return ((r.data ?? []) as Record<string, unknown>[]).map((b) => ({
    kind: String(b['kind']),
    forDate: String(b['for_date']),
    title: String(b['title']),
    sections: (b['sections'] ?? []) as StoredBrief['sections'],
    delivery: (b['delivery'] ?? {}) as Record<string, string>,
    createdAt: String(b['created_at']),
  }));
}
