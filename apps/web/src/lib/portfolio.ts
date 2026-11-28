/**
 * Reads behind the portfolio views (holdings table, portfolio report, dividend calendar): company names, the
 * stored Tauric research parts (validated again in core, as ADR 0047 says), stored dividends, holdings news and
 * alerts on holdings. Every read goes through row-level security; a part that fails validation is shown as
 * unavailable with its reason, never repaired.
 */
import {
  RESEARCH_PARTS,
  researchPartAsOf,
  validateResearchPart,
  type PayoutRow,
  type ResearchPart,
  type TauricAnalyst,
  type TauricCalendar,
  type TauricProfile,
  type TauricThesis,
} from '@marsad/core';
import { supabase } from './supabase';

function client() {
  if (!supabase) throw new Error('not configured');
  return supabase;
}

export interface ResearchParts {
  analyst: TauricAnalyst | null;
  profile: TauricProfile | null;
  calendar: TauricCalendar | null;
  thesis: TauricThesis | null;
  /** The as-of time of each part that is stored and valid. */
  asOf: Partial<Record<ResearchPart, string | null>>;
  /** Why a part is missing: the job's stored error code, or Marsad's own validation reason. */
  missing: Partial<Record<ResearchPart, string>>;
}

export interface PortfolioData {
  names: Record<string, string>;
  research: Record<string, ResearchParts>;
  /** Stored Massive dividends with ex-dates from 400 days back, oldest first. */
  dividends: PayoutRow[];
  /** When the newest dividend row was fetched, or null when none is stored. */
  dividendsFetchedAt: string | null;
}

const DIVIDEND_LOOKBACK_DAYS = 400;

function researchOf(row: Record<string, unknown>, ticker: string): ResearchParts {
  const out: ResearchParts = {
    analyst: null,
    profile: null,
    calendar: null,
    thesis: null,
    asOf: {},
    missing: {},
  };
  const errors = (row['errors'] ?? {}) as Record<string, unknown>;
  for (const part of RESEARCH_PARTS) {
    const raw = row[part];
    if (raw === null || raw === undefined) {
      out.missing[part] =
        typeof errors[part] === 'string' ? (errors[part] as string) : 'not stored';
      continue;
    }
    const v = validateResearchPart(part, raw, ticker);
    if (!v.ok) {
      out.missing[part] = v.reason;
      continue;
    }
    (out as unknown as Record<string, unknown>)[part] = v.value;
    out.asOf[part] = researchPartAsOf(part, v.value);
  }
  return out;
}

/** Names, Tauric research and stored dividends for a set of tickers. */
export async function loadPortfolioData(
  tickers: readonly string[],
  today: string,
): Promise<PortfolioData> {
  if (tickers.length === 0)
    return { names: {}, research: {}, dividends: [], dividendsFetchedAt: null };
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - DIVIDEND_LOOKBACK_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const list = [...tickers];
  const [inst, res, div] = await Promise.all([
    client()
      .from('instruments')
      .select('ticker, name')
      .in('ticker', list)
      .limit(list.length * 2),
    client()
      .from('company_research')
      .select(
        'ticker, analyst, profile, thesis, calendar, analyst_refreshed_at, profile_refreshed_at, thesis_generated_at, calendar_refreshed_at, errors',
      )
      .in('ticker', list),
    client()
      .from('dividends')
      .select('ticker, ex_dividend_date, pay_date, cash_amount, frequency, fetched_at')
      .in('ticker', list)
      .gte('ex_dividend_date', since)
      .order('ex_dividend_date', { ascending: true })
      .limit(2000),
  ]);
  if (inst.error) throw new Error(`instruments: ${inst.error.message}`);
  if (res.error) throw new Error(`company_research: ${res.error.message}`);
  if (div.error) throw new Error(`dividends: ${div.error.message}`);
  const names: Record<string, string> = {};
  for (const r of (inst.data ?? []) as Record<string, unknown>[])
    if (r['name']) names[String(r['ticker'])] = String(r['name']);
  const research: Record<string, ResearchParts> = {};
  for (const r of (res.data ?? []) as Record<string, unknown>[]) {
    const tk = String(r['ticker']);
    research[tk] = researchOf(r, tk);
  }
  let fetched: string | null = null;
  const dividends: PayoutRow[] = ((div.data ?? []) as Record<string, unknown>[]).map((r) => {
    const f = r['fetched_at'] ? String(r['fetched_at']) : null;
    if (f && (!fetched || f > fetched)) fetched = f;
    return {
      ticker: String(r['ticker']),
      exDate: String(r['ex_dividend_date']),
      payDate: r['pay_date'] ? String(r['pay_date']) : null,
      amount: Number(r['cash_amount']),
      frequency:
        r['frequency'] === null || r['frequency'] === undefined ? null : Number(r['frequency']),
      source: 'massive',
    };
  });
  return { names, research, dividends, dividendsFetchedAt: fetched };
}

/** Tauric's calendar dividends of every ticker, in the shape `mergeDividends` takes. */
export function tauricDividends(research: Record<string, ResearchParts>) {
  return Object.entries(research).flatMap(([ticker, r]) =>
    (r.calendar?.dividends ?? []).map((d) => ({ ticker, exDate: d.ex_date, amount: d.amount })),
  );
}

export interface HoldingNews {
  id: string;
  publishedAt: string;
  publisher: string;
  title: string;
  url: string;
  tickers: string[];
  /** The stored description, shown as plain text; null when the vendor gave none. */
  description: string | null;
}

/** The newest stored articles that name a holding (no images, no full text: only what the feed stores). */
export async function loadHoldingsNews(tickers: readonly string[]): Promise<HoldingNews[]> {
  if (tickers.length === 0) return [];
  const r = await client()
    .from('news_articles')
    .select('id, published_at, publisher, title, url, tickers, description')
    .overlaps('tickers', [...tickers])
    .order('published_at', { ascending: false })
    .limit(120);
  if (r.error) throw new Error(`news_articles: ${r.error.message}`);
  return ((r.data ?? []) as Record<string, unknown>[]).map((x) => ({
    id: String(x['id']),
    publishedAt: new Date(String(x['published_at'])).toISOString(),
    publisher: String(x['publisher']),
    title: String(x['title']),
    url: String(x['url']),
    tickers: Array.isArray(x['tickers']) ? (x['tickers'] as string[]) : [],
    description: typeof x['description'] === 'string' ? x['description'] : null,
  }));
}

export interface HoldingAlert {
  id: string;
  ticker: string;
  headline: string;
  createdAt: string;
  kind: string;
}

/** Delivered Marsad alerts on the holdings since a date (suppressed ones are left out). */
export async function loadHoldingAlerts(
  tickers: readonly string[],
  since: string,
): Promise<HoldingAlert[]> {
  if (tickers.length === 0) return [];
  const r = await client()
    .from('alerts')
    .select('id, ticker, headline, created_at, kind')
    .in('ticker', [...tickers])
    .neq('decision', 'suppress')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(100);
  if (r.error) throw new Error(`alerts: ${r.error.message}`);
  return ((r.data ?? []) as Record<string, unknown>[]).map((x) => ({
    id: String(x['id']),
    ticker: String(x['ticker']),
    headline: String(x['headline']),
    createdAt: String(x['created_at']),
    kind: String(x['kind']),
  }));
}

/**
 * Owner or member, for the limits label only (never for access: row-level security decides that). Interim until
 * stored per-user limits arrive: `briefs` is owner-only (ADR 0040) and the owner has a brief every session day, so
 * a member reads none and sees "No limit set".
 */
export async function loadLimitsRole(): Promise<'owner' | 'member'> {
  const r = await client().from('briefs').select('for_date').limit(1);
  if (r.error) throw new Error(`briefs: ${r.error.message}`);
  return (r.data ?? []).length > 0 ? 'owner' : 'member';
}
