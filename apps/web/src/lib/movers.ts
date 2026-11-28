/**
 * Data behind the movers view (movers-1, ADR 0049; placement and access, ADR 0048). Self-contained so the view can
 * mount on Watch now and on a Markets page later. Every read goes through row-level security:
 * - `market_movers_daily` (members): the Marsad universe movers (watch-1) and the version marker of the owner's row.
 * - `market_movers_market` (owner only): the whole-market session, computed by the breadth job.
 * - `daily_bars` and `splits` (members): the "On my list" filter, computed here by the same core function.
 * - `news_articles`, `instruments` and `filings`: names and the latest stored headline or filing per ticker.
 */
import {
  STARTING_TICKERS,
  etWallToUtc,
  moversSession,
  type MarketMovers,
  type MoversSession,
  type ShareChange,
  type TickerSeries,
} from '@marsad/core';
import { supabase } from './supabase';

function client() {
  if (!supabase) throw new Error('not configured');
  return supabase;
}

const num = (v: unknown): number => Number(v);

export interface MoversData {
  /** The newest Marsad universe movers (watch-1), or null before the breadth job's first run. */
  universe: MarketMovers | null;
  /** The formula version of the owner-only whole-market row for that session (readable by members), or null. */
  marketVersion: string | null;
  /** The whole-market session, or null when it is not computed yet or this account is not the owner. */
  market: (MoversSession & { computedAt: string }) | null;
}

/** Whether a PostgREST error means the table is not there yet (the migration has not reached this database). */
const missingTable = (e: { code?: string } | null) =>
  !!e && (e.code === 'PGRST205' || e.code === '42P01');

export async function loadMovers(): Promise<MoversData> {
  const [u, m] = await Promise.all([
    client().from('market_movers_daily').select('*').order('date', { ascending: false }).limit(1),
    client()
      .from('market_movers_market')
      .select('date, version, session, computed_at')
      .order('date', { ascending: false })
      .limit(1),
  ]);
  if (u.error) throw new Error(`market_movers_daily: ${u.error.message}`);
  if (m.error && !missingTable(m.error))
    throw new Error(`market_movers_market: ${m.error.message}`);
  const r = (u.data ?? [])[0] as Record<string, unknown> | undefined;
  const s = (m.error ? [] : (m.data ?? []))[0] as Record<string, unknown> | undefined;
  return {
    universe: r
      ? {
          date: String(r['date']),
          version: String(r['version']),
          n: num(r['n']),
          gainers: r['gainers'] as MarketMovers['gainers'],
          losers: r['losers'] as MarketMovers['losers'],
          sectors: r['sectors'] as MarketMovers['sectors'],
        }
      : null,
    marketVersion: r && typeof r['market_version'] === 'string' ? r['market_version'] : null,
    market: s ? { ...(s['session'] as MoversSession), computedAt: String(s['computed_at']) } : null,
  };
}

/** Watchlist tickers (or the starting tickers until a watchlist is saved) and open holdings. */
export async function loadMyTickers(): Promise<{ watchlist: string[]; holdings: string[] }> {
  const [w, h] = await Promise.all([
    client().from('watchlist_items').select('ticker').limit(100),
    client().from('holdings').select('ticker').is('closed_on', null).limit(200),
  ]);
  if (w.error) throw new Error(`watchlist_items: ${w.error.message}`);
  if (h.error) throw new Error(`holdings: ${h.error.message}`);
  const saved = [...new Set(((w.data ?? []) as { ticker: string }[]).map((x) => x.ticker))];
  return {
    watchlist: saved.length > 0 ? saved : [...STARTING_TICKERS],
    holdings: [...new Set(((h.data ?? []) as { ticker: string }[]).map((x) => x.ticker))],
  };
}

/** Bars read per ticker: the 252-session window plus a margin. */
const MY_SESSIONS = 270;

/**
 * "On my list": the same movers-1 lists over the watchlist and holdings, from their stored daily bars (Massive,
 * split-adjusted), with the stored splits as corporate-action checks. Tickers with no stored bars are listed.
 */
export async function loadMyMovers(
  tickers: readonly string[],
): Promise<{ session: MoversSession | null; noBars: string[] }> {
  if (tickers.length === 0) return { session: null, noBars: [] };
  const [lists, sp] = await Promise.all([
    Promise.all(
      tickers.map(async (t) => {
        const r = await client()
          .from('daily_bars')
          .select('date, close, volume')
          .eq('ticker', t)
          .order('date', { ascending: false })
          .limit(MY_SESSIONS);
        if (r.error) throw new Error(`daily_bars ${t}: ${r.error.message}`);
        return (r.data ?? []) as Record<string, unknown>[];
      }),
    ),
    client()
      .from('splits')
      .select('ticker, execution_date, split_from, split_to')
      .in('ticker', [...tickers])
      .limit(500),
  ]);
  if (sp.error) throw new Error(`splits: ${sp.error.message}`);
  const dates = [...new Set(lists.flat().map((x) => String(x['date'])))].sort();
  const at = new Map(dates.map((d, i) => [d, i]));
  const series = new Map<string, TickerSeries>();
  const noBars: string[] = [];
  tickers.forEach((t, j) => {
    const rows = lists[j] ?? [];
    if (rows.length === 0) {
      noBars.push(t);
      return;
    }
    const close = new Array<number | null>(dates.length).fill(null);
    const volume = new Array<number | null>(dates.length).fill(null);
    for (const x of rows) {
      const i = at.get(String(x['date']));
      if (i === undefined) continue;
      close[i] = num(x['close']);
      volume[i] = num(x['volume']);
    }
    series.set(t, { close, volume });
  });
  if (dates.length === 0) return { session: null, noBars };
  const splits: ShareChange[] = ((sp.data ?? []) as Record<string, unknown>[]).map((x) => ({
    ticker: String(x['ticker']),
    executionDate: String(x['execution_date']),
    splitFrom: num(x['split_from']),
    splitTo: num(x['split_to']),
  }));
  return {
    session: moversSession({
      dates,
      series,
      eligible: new Set(series.keys()),
      splits,
      i: dates.length - 1,
    }),
    noBars: noBars.sort(),
  };
}

/** The latest stored headline or filing for a ticker: matched by code, never an explanation of a move. */
export interface Catalyst {
  kind: 'news' | 'filing';
  /** The headline, or the filing's form and items. */
  title: string;
  /** The publisher, or SEC EDGAR. */
  source: string;
  /** When it was published or accepted (UTC ISO); a date-only filing is marked by `dateOnly`. */
  at: string;
  dateOnly: boolean;
  url: string | null;
}

export interface MoverContext {
  names: Record<string, string>;
  catalysts: Record<string, Catalyst>;
}

/** The start of the session before the latest (00:00 ET), the window for "within the last 2 sessions". */
export function catalystSince(previousDate: string | null, date: string): Date {
  return etWallToUtc(previousDate ?? date, 0, 0);
}

const httpsOnly = (u: unknown) => (typeof u === 'string' && /^https:\/\//.test(u) ? u : null);

function filingUrl(cik: string, accession: string, doc: string | null): string {
  const folder = accession.replace(/-/g, '');
  const c = String(Number(cik));
  return doc
    ? `https://www.sec.gov/Archives/edgar/data/${c}/${folder}/${doc}`
    : `https://www.sec.gov/Archives/edgar/data/${c}/${folder}/`;
}

/** Names (when stored) and the newest stored news headline or filing since `since`, for these tickers. */
export async function loadMoverContext(
  tickers: readonly string[],
  since: Date,
): Promise<MoverContext> {
  if (tickers.length === 0) return { names: {}, catalysts: {} };
  const list = [...tickers];
  const [inst, news] = await Promise.all([
    client()
      .from('instruments')
      .select('ticker, cik, name')
      .in('ticker', list)
      .limit(list.length * 2),
    client()
      .from('news_articles')
      .select('published_at, publisher, title, url, tickers')
      .overlaps('tickers', list)
      .gte('published_at', since.toISOString())
      .order('published_at', { ascending: false })
      .limit(200),
  ]);
  if (inst.error) throw new Error(`instruments: ${inst.error.message}`);
  if (news.error) throw new Error(`news_articles: ${news.error.message}`);
  const names: Record<string, string> = {};
  const byCik: Record<string, string[]> = {};
  for (const r of (inst.data ?? []) as Record<string, unknown>[]) {
    const t = String(r['ticker']);
    if (r['name']) names[t] = String(r['name']);
    if (r['cik']) (byCik[String(r['cik'])] ??= []).push(t);
  }
  const catalysts: Record<string, Catalyst> = {};
  const offer = (t: string, c: Catalyst) => {
    const cur = catalysts[t];
    if (!cur || c.at > cur.at) catalysts[t] = c;
  };
  const wanted = new Set(list);
  for (const r of (news.data ?? []) as Record<string, unknown>[]) {
    const c: Catalyst = {
      kind: 'news',
      title: String(r['title']),
      source: String(r['publisher']),
      at: new Date(String(r['published_at'])).toISOString(),
      dateOnly: false,
      url: httpsOnly(r['url']),
    };
    for (const t of Array.isArray(r['tickers']) ? (r['tickers'] as string[]) : [])
      if (wanted.has(t)) offer(t, c);
  }
  const ciks = Object.keys(byCik);
  if (ciks.length > 0) {
    const sinceDate = since.toISOString().slice(0, 10);
    const f = await client()
      .from('filings')
      .select('accession, cik, form, filing_date, accepted_at, primary_document, items')
      .in('cik', ciks)
      .gte('filing_date', sinceDate)
      .order('filing_date', { ascending: false })
      .limit(200);
    if (f.error) throw new Error(`filings: ${f.error.message}`);
    for (const r of (f.data ?? []) as Record<string, unknown>[]) {
      const accepted = r['accepted_at'] ? new Date(String(r['accepted_at'])) : null;
      if (accepted && accepted < since) continue;
      const items = Array.isArray(r['items']) ? (r['items'] as string[]) : [];
      const c: Catalyst = {
        kind: 'filing',
        title:
          items.length > 0 ? `${String(r['form'])} (items ${items.join(', ')})` : String(r['form']),
        source: 'SEC EDGAR',
        at: accepted ? accepted.toISOString() : `${String(r['filing_date'])}T00:00:00.000Z`,
        dateOnly: !accepted,
        url: filingUrl(
          String(r['cik']),
          String(r['accession']),
          r['primary_document'] ? String(r['primary_document']) : null,
        ),
      };
      for (const t of byCik[String(r['cik'])] ?? []) offer(t, c);
    }
  }
  return { names, catalysts };
}
