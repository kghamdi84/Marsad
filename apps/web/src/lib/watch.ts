import {
  CORE_ETFS,
  breadthReading,
  type BreadthDay,
  type TopicDay,
  STARTING_TICKERS,
  type DailyBar,
  type EarningsEstimate,
  type EconEvent,
  type MarketMovers,
  type NewsItem,
  type Obs,
} from '@marsad/core';
import { supabase } from './supabase';
import type { FilingRow } from './study';
import { isCurrent, loadBarsBatch, loadSummaries, type StoredSummary } from './summary';

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
  /** The sector fund chosen for each saved ticker (null when none is set). */
  sectorOf: Record<string, string | null>;
  /** The newest universe strength rank (strength-1) of each ticker in the universe. */
  strength: Record<string, StrengthView>;
  /** The newest nightly summary row of each watchlist ticker (ADR 0050); absent before the job's first run. */
  summary: Record<string, StoredSummary>;
}

/**
 * Sessions of bars Watch reads per ticker when the nightly summary covers it: the 30-session sparkline, the
 * 1-day and 1-month change, the volume base and the 63-session strength against the chosen sector fund.
 */
export const WATCH_SESSIONS = 70;

export interface StrengthView {
  date: string;
  percentile: number;
  rank: number;
  members: number;
}

/** The newest strength rank of each ticker; tickers outside the 1,000-stock universe have none. */
export async function loadStrength(
  tickers: readonly string[],
): Promise<Record<string, StrengthView>> {
  if (tickers.length === 0) return {};
  const r = await client()
    .from('strength_rank_daily')
    .select('ticker, date, percentile, rank, members')
    .eq('version', 'strength-1')
    .in('ticker', [...tickers])
    .order('date', { ascending: false })
    .limit(tickers.length * 5);
  if (r.error) throw new Error(`strength_rank_daily: ${r.error.message}`);
  const out: Record<string, StrengthView> = {};
  for (const x of (r.data ?? []) as Record<string, unknown>[]) {
    const t = String(x['ticker']);
    if (out[t]) continue;
    out[t] = {
      date: String(x['date']),
      percentile: num(x['percentile']),
      rank: num(x['rank']),
      members: num(x['members']),
    };
  }
  return out;
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

/** The newest closes of several tickers in one read (for list sparklines), oldest first per ticker. */
export async function loadRecentBars(
  tickers: readonly string[],
  sessions = 30,
): Promise<Record<string, DailyBar[]>> {
  const r = await client()
    .from('daily_bars')
    .select('ticker, date, open, high, low, close, volume, vwap')
    .in('ticker', [...tickers])
    .order('date', { ascending: false })
    .limit(tickers.length * (sessions + 10));
  if (r.error) throw new Error(`daily_bars: ${r.error.message}`);
  const out: Record<string, DailyBar[]> = {};
  for (const x of (r.data ?? []) as Record<string, unknown>[]) {
    const tk = String(x['ticker']);
    const list = (out[tk] ??= []);
    if (list.length >= sessions) continue;
    list.push({
      date: String(x['date']),
      open: num(x['open']),
      high: num(x['high']),
      low: num(x['low']),
      close: num(x['close']),
      volume: num(x['volume']),
      vwap: x['vwap'] === null ? null : num(x['vwap']),
    });
  }
  for (const k of Object.keys(out)) out[k]?.reverse();
  return out;
}

/** Everything the Watch dashboard shows besides the calendars. Every read goes through row-level security. */
export async function loadWatch(): Promise<WatchData> {
  const items = await client()
    .from('watchlist_items')
    .select('ticker, position, sector_etf')
    .order('position', { ascending: true })
    .limit(100);
  if (items.error) throw new Error(`watchlist_items: ${items.error.message}`);
  const sectorOf: Record<string, string | null> = {};
  for (const x of (items.data ?? []) as { ticker: string; sector_etf: string | null }[])
    sectorOf[x.ticker] = x.sector_etf ?? null;
  const saved = [...new Set(((items.data ?? []) as { ticker: string }[]).map((x) => x.ticker))];
  const tickers = saved.length > 0 ? saved : [...STARTING_TICKERS];
  const strengthP = loadStrength(tickers);
  const restP = Promise.all([
    Promise.all(STRIP_SERIES.map((id) => seriesOf(id))),
    client().from('market_movers_daily').select('*').order('date', { ascending: false }).limit(1),
    client()
      .from('news_articles')
      .select('id, published_at, publisher, title, url, tickers')
      .overlaps('tickers', tickers)
      .order('published_at', { ascending: false })
      .limit(80),
  ]);
  // The summary first: it names the GICS sector fund of tickers with no fund chosen, whose bars the strength
  // column needs. The viewer's own choice wins over the mapping.
  const summary = await loadSummaries(tickers);
  const sectorFunds = tickers
    .map((tk) => sectorOf[tk] ?? summary[tk]?.sector_etf ?? null)
    .filter((s): s is string => s !== null);
  const barTickers = [...new Set([...tickers, ...STRIP_BARS, ...sectorFunds])];
  const bars = await loadBarsBatch(barTickers, WATCH_SESSIONS);
  // A watchlist ticker without a current summary row is computed from its bars, which needs the full year; a
  // ticker the batch returned nothing for is read alone.
  const full = barTickers.filter(
    (tk) =>
      (bars[tk] ?? []).length === 0 ||
      (tickers.includes(tk) && !isCurrent(summary[tk], bars[tk] ?? [])),
  );
  const fullLists = await Promise.all(full.map((t) => barsOf(t)));
  full.forEach((t, i) => (bars[t] = fullLists[i] ?? []));
  for (const t of barTickers) bars[t] ??= [];
  const [seriesLists, moversR, newsR] = await restP;
  if (moversR.error) throw new Error(`market_movers_daily: ${moversR.error.message}`);
  if (newsR.error) throw new Error(`news_articles: ${newsR.error.message}`);
  const series: Record<string, Obs[]> = {};
  STRIP_SERIES.forEach((id, i) => (series[id] = seriesLists[i] ?? []));
  const m = (moversR.data ?? [])[0] as Record<string, unknown> | undefined;
  return {
    tickers,
    defaultList: saved.length === 0,
    sectorOf,
    strength: await strengthP,
    summary,
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
    .in('kind', ['pre-market', 'close-recap'])
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

// ---------------------------------------------------------------------------------------------------------------
// Marsad v2: the morning decision cockpit and the company names, filings and topic norms behind the news ranking.

export interface CockpitData {
  /** The newest regime days, oldest first (enough for the current run in most markets). */
  regime: { date: string; label: string; ruleVersion: string; vix: number | null }[];
  /** The newest breadth day: percent of the universe above its 50-day average. */
  breadth: { date: string; pctAbove50: number | null } | null;
  /** Stored topic days for the topic norm (`topics-1`), oldest first. */
  topics: TopicDay[];
  /** NYSE early closes and closures from today on. */
  holidays: { date: string; name: string; status: string; closeAt: string | null }[];
}

/** Rows the regime run can span; a longer run is shown as "at least" this many sessions. */
export const REGIME_DAYS = 260;

/** The cockpit's market inputs. Every read goes through row-level security. */
export async function loadCockpit(today: string): Promise<CockpitData> {
  const [regR, brR, topR, holR] = await Promise.all([
    client()
      .from('regime_daily')
      .select('date, label, rule_version, inputs')
      .order('date', { ascending: false })
      .limit(REGIME_DAYS),
    client().from('breadth_daily').select('*').order('date', { ascending: false }).limit(1),
    client().from('news_topic_days').select('*').order('date', { ascending: false }).limit(40),
    client()
      .from('market_holidays')
      .select('date, name, status, close_at')
      .eq('exchange', 'NYSE')
      .gte('date', today)
      .order('date', { ascending: true })
      .limit(5),
  ]);
  if (regR.error) throw new Error(`regime_daily: ${regR.error.message}`);
  if (brR.error) throw new Error(`breadth_daily: ${brR.error.message}`);
  if (topR.error) throw new Error(`news_topic_days: ${topR.error.message}`);
  if (holR.error) throw new Error(`market_holidays: ${holR.error.message}`);
  const b = (brR.data ?? [])[0] as Record<string, unknown> | undefined;
  return {
    regime: ((regR.data ?? []) as Record<string, unknown>[])
      .map((r) => {
        const inputs = (r['inputs'] ?? {}) as { vix?: number | null };
        return {
          date: String(r['date']),
          label: String(r['label']),
          ruleVersion: String(r['rule_version']),
          vix: typeof inputs.vix === 'number' ? inputs.vix : null,
        };
      })
      .reverse(),
    breadth: b
      ? {
          date: String(b['date']),
          pctAbove50: breadthReading(b as unknown as BreadthDay).pctAbove50,
        }
      : null,
    topics: ((topR.data ?? []) as Record<string, unknown>[])
      .map((r) => ({
        date: String(r['date']),
        version: String(r['version']),
        total: num(r['total']),
        counts: r['counts'] as TopicDay['counts'],
        samples: r['samples'] as TopicDay['samples'],
      }))
      .reverse(),
    holidays: ((holR.data ?? []) as Record<string, unknown>[]).map((h) => ({
      date: String(h['date']),
      name: String(h['name']),
      status: String(h['status']),
      closeAt: h['close_at'] ? String(h['close_at']) : null,
    })),
  };
}

export interface StoredFiling extends FilingRow {
  cik: string;
  /** Tickers the issuer trades under, from the watchlist and holdings. */
  tickers: string[];
}

export interface CompanyData {
  /** Company name by ticker (from `instruments`); missing when not stored. */
  names: Record<string, string>;
  /** 8-K, 10-Q and 10-K filings of these companies over the last 10 days, newest first. */
  filings: StoredFiling[];
}

/** Forms shown as news: current reports and periodic reports, with their amendments. */
export const NEWS_FORMS = ['8-K', '8-K/A', '10-Q', '10-Q/A', '10-K', '10-K/A'] as const;

/** Company names and recent filings for the watchlist and holdings. Filings are owner-only (RLS). */
export async function loadCompanies(
  tickers: readonly string[],
  since: string,
): Promise<CompanyData> {
  if (tickers.length === 0) return { names: {}, filings: [] };
  const inst = await client()
    .from('instruments')
    .select('ticker, cik, name')
    .in('ticker', [...tickers])
    .limit(tickers.length * 2);
  if (inst.error) throw new Error(`instruments: ${inst.error.message}`);
  const names: Record<string, string> = {};
  const byCik: Record<string, string[]> = {};
  for (const r of (inst.data ?? []) as Record<string, unknown>[]) {
    const tk = String(r['ticker']);
    if (r['name']) names[tk] = String(r['name']);
    if (r['cik']) (byCik[String(r['cik'])] ??= []).push(tk);
  }
  const ciks = Object.keys(byCik);
  if (ciks.length === 0) return { names, filings: [] };
  const f = await client()
    .from('filings')
    .select('accession, cik, form, filing_date, accepted_at, primary_document, items')
    .in('cik', ciks)
    .in('form', [...NEWS_FORMS])
    .gte('filing_date', since)
    .order('filing_date', { ascending: false })
    .limit(60);
  if (f.error) throw new Error(`filings: ${f.error.message}`);
  return {
    names,
    filings: ((f.data ?? []) as Record<string, unknown>[]).map((r) => ({
      accession: String(r['accession']),
      cik: String(r['cik']),
      form: String(r['form']),
      filingDate: String(r['filing_date']),
      acceptedAt: r['accepted_at'] ? String(r['accepted_at']) : null,
      primaryDocument: r['primary_document'] ? String(r['primary_document']) : null,
      items: Array.isArray(r['items']) ? (r['items'] as string[]) : [],
      tickers: byCik[String(r['cik'])] ?? [],
    })),
  };
}
