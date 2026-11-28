/**
 * Readers for the Study research tab. `company_research` holds the Tauric analyst, profile and thesis payloads as
 * the research job received them (ADR 0047); this module reads them through row-level security and checks each
 * field again on the way in: a number must be finite, a count non-negative, and the price targets in order. A
 * field that fails is left out (null), never shown as a guess.
 */
import type { DailyBar, StoredDividend } from '@marsad/core';
import { supabase } from './supabase';
import { loadRecentDailyBars } from './studyPanels';

function client() {
  if (!supabase) throw new Error('not configured');
  return supabase;
}
function check<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null;
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v)
    ? v
    : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))
      ? Number(v)
      : null;
const count = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && n >= 0 && Number.isInteger(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const refreshed = (o: Obj | null): string | null =>
  str(obj(o?.['dataset_status'])?.['refreshed_at']);

export interface Analyst {
  recommendation: string | null;
  targetMean: number | null;
  targetMedian: number | null;
  targetHigh: number | null;
  targetLow: number | null;
  /** False when the targets are out of order (low, median, high); the page then shows none of them. */
  targetsOrdered: boolean;
  analysts: number | null;
  ratingsTotal: number | null;
  strongBuy: number | null;
  buy: number | null;
  hold: number | null;
  sell: number | null;
  strongSell: number | null;
  trailingEps: number | null;
  forwardEps: number | null;
  refreshedAt: string | null;
}

export const PROFILE_NUMBERS = [
  'market_cap',
  'enterprise_value',
  'pe_ratio',
  'forward_pe',
  'peg_ratio',
  'price_to_book',
  'price_to_sales',
  'profit_margin',
  'operating_margin',
  'return_on_assets',
  'return_on_equity',
  'revenue_growth',
  'earnings_growth',
  'total_cash',
  'total_debt',
  'debt_to_equity',
  'current_ratio',
  'quick_ratio',
  'dividend_rate',
  'dividend_yield',
  'payout_ratio',
  'beta',
  'shares_outstanding',
  'float_shares',
  'employees',
  'shares_short',
  'days_to_cover',
  'short_interest_of_float',
  'institutional_ownership',
  'insider_ownership',
] as const;
export type ProfileNumber = (typeof PROFILE_NUMBERS)[number];

export interface Profile {
  numbers: Record<ProfileNumber, number | null>;
  sector: string | null;
  industryGroup: string | null;
  industry: string | null;
  subIndustry: string | null;
  country: string | null;
  website: string | null;
  description: string | null;
  marketCapPriceDate: string | null;
  refreshedAt: string | null;
}

export interface Catalyst {
  date: string | null;
  text: string;
  status: string | null;
}

export interface Thesis {
  narrative: string | null;
  drivers: string[];
  risks: string[];
  catalysts: Catalyst[];
  openQuestions: string[];
  generatedAt: string | null;
  cutoff: string | null;
  revision: string | null;
}

/** Optional: a Tauric calendar part, when the research job stores one. */
export interface ResearchCalendar {
  earnings: {
    date: string | null;
    periodEnd: string | null;
    epsEstimate: number | null;
    epsLow: number | null;
    epsHigh: number | null;
  } | null;
  dividends: { exDate: string; amount: number | null }[];
  refreshedAt: string | null;
}

export interface CompanyResearch {
  ticker: string;
  source: string;
  analyst: Analyst | null;
  profile: Profile | null;
  thesis: Thesis | null;
  calendar: ResearchCalendar | null;
  fetchedAt: string | null;
  /** Why a part is missing, per part, as the job recorded it. */
  errors: Record<string, string>;
}

function parseAnalyst(v: unknown, at: unknown): Analyst | null {
  const o = obj(v);
  if (!o) return null;
  const low = num(o['target_low_price']);
  const med = num(o['target_median_price']);
  const high = num(o['target_high_price']);
  const mean = num(o['target_mean_price']);
  const present = [low, med, high, mean].filter((x): x is number => x !== null);
  const ordered =
    present.every((x) => x > 0) &&
    (low === null || med === null || low <= med) &&
    (med === null || high === null || med <= high) &&
    (low === null || high === null || low <= high) &&
    (mean === null || ((low === null || low <= mean) && (high === null || mean <= high)));
  return {
    recommendation: str(o['recommendation']),
    targetMean: ordered ? mean : null,
    targetMedian: ordered ? med : null,
    targetHigh: ordered ? high : null,
    targetLow: ordered ? low : null,
    targetsOrdered: ordered,
    analysts: count(o['number_of_analysts']),
    ratingsTotal: count(o['ratings_total']),
    strongBuy: count(o['strong_buy']),
    buy: count(o['buy']),
    hold: count(o['hold']),
    sell: count(o['sell']),
    strongSell: count(o['strong_sell']),
    trailingEps: num(o['trailing_eps']),
    forwardEps: num(o['forward_eps']),
    refreshedAt: str(at) ?? refreshed(o),
  };
}

function parseProfile(v: unknown, at: unknown): Profile | null {
  const o = obj(v);
  if (!o) return null;
  const numbers = {} as Record<ProfileNumber, number | null>;
  for (const k of PROFILE_NUMBERS) numbers[k] = num(o[k]);
  for (const k of ['market_cap', 'shares_outstanding', 'float_shares', 'employees'] as const)
    if (numbers[k] !== null && (numbers[k] as number) < 0) numbers[k] = null;
  const site = str(o['website']);
  return {
    numbers,
    sector: str(o['sector']),
    industryGroup: str(o['industry_group']),
    industry: str(o['industry']),
    subIndustry: str(o['sub_industry']),
    country: str(o['country']),
    // A link only when it is https (a vendor string is never trusted as a URL otherwise).
    website: site && /^https:\/\//.test(site) ? site : null,
    description: str(o['description']),
    marketCapPriceDate: str(o['market_cap_price_date']),
    refreshedAt: str(at) ?? refreshed(o),
  };
}

const texts = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.flatMap((x) => {
        const s = typeof x === 'string' ? x : str(obj(x)?.['text']);
        return s ? [s] : [];
      })
    : [];

function parseThesis(v: unknown, at: unknown): Thesis | null {
  const o = obj(v);
  if (!o) return null;
  // The job stores the content flat; a payload kept whole has it under "content".
  const c = obj(o['content']) ?? o;
  return {
    narrative: str(c['narrative']),
    drivers: texts(c['drivers']),
    risks: texts(c['risks']),
    catalysts: Array.isArray(c['catalysts'])
      ? c['catalysts'].flatMap((x) => {
          const k = obj(x);
          const text = str(k?.['text']);
          if (!k || !text) return [];
          const date = str(k['date']);
          return [
            {
              date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
              text,
              status: str(k['timing_status']),
            },
          ];
        })
      : [],
    openQuestions: texts(c['open_questions']),
    generatedAt: str(at) ?? str(o['generated_at']),
    cutoff: str(o['cutoff']) ?? str(obj(o['evidence'])?.['cutoff']),
    revision: str(o['revision']),
  };
}

function parseCalendar(v: unknown): ResearchCalendar | null {
  const o = obj(v);
  if (!o) return null;
  const e = obj(o['earnings']);
  return {
    earnings: e
      ? {
          date: str(e['date']) ?? str(e['report_date']),
          periodEnd: str(e['period_end']) ?? str(e['fiscal_period_end']),
          epsEstimate: num(e['eps_estimate']) ?? num(e['eps_average']) ?? num(e['eps_avg']),
          epsLow: num(e['eps_low']),
          epsHigh: num(e['eps_high']),
        }
      : null,
    dividends: Array.isArray(o['dividends'])
      ? o['dividends'].flatMap((x) => {
          const d = obj(x);
          const ex = str(d?.['ex_date']);
          return ex ? [{ exDate: ex, amount: num(d?.['amount']) }] : [];
        })
      : [],
    refreshedAt: refreshed(obj(o['earnings_status']) ? { dataset_status: o['earnings_status'] } : o),
  };
}

export function parseResearchRow(r: Obj): CompanyResearch {
  const errors: Record<string, string> = {};
  const e = obj(r['errors']);
  if (e) for (const [k, v] of Object.entries(e)) if (typeof v === 'string') errors[k] = v;
  const analyst = parseAnalyst(r['analyst'], r['analyst_refreshed_at']);
  if (analyst && !analyst.targetsOrdered) errors['targets'] = 'malformed';
  return {
    ticker: String(r['ticker']),
    source: str(r['source']) ?? 'tauric',
    analyst,
    profile: parseProfile(r['profile'], r['profile_refreshed_at']),
    thesis: parseThesis(r['thesis'], r['thesis_generated_at']),
    calendar: parseCalendar(r['calendar']),
    fetchedAt: str(r['fetched_at']),
    errors,
  };
}

/** The stored research row for one ticker, or null when the job has not covered it. */
export async function loadCompanyResearch(ticker: string): Promise<CompanyResearch | null> {
  const row = check(
    await client().from('company_research').select('*').eq('ticker', ticker).maybeSingle(),
    'company_research',
  ) as Obj | null;
  return row ? parseResearchRow(row) : null;
}

export interface PeerRow {
  ticker: string;
  profile: Profile | null;
  bars: DailyBar[];
}

/**
 * Other tickers with stored research in the same Tauric sub-industry, else the same industry. Each peer's
 * one-year return comes from Marsad's own stored closes.
 */
export async function loadPeers(
  ticker: string,
  subIndustry: string | null,
  industry: string | null,
): Promise<{ basis: 'sub_industry' | 'industry' | null; rows: PeerRow[] }> {
  const ask = async (field: 'sub_industry' | 'industry', value: string) =>
    (
      check(
        await client()
          .from('company_research')
          .select('ticker, profile, profile_refreshed_at')
          .eq(`profile->>${field}`, value)
          .neq('ticker', ticker)
          .order('ticker', { ascending: true })
          .limit(12),
        'company_research',
      ) as Obj[]
    ).map((r) => ({
      ticker: String(r['ticker']),
      profile: parseProfile(r['profile'], r['profile_refreshed_at']),
    }));
  let basis: 'sub_industry' | 'industry' | null = null;
  let list: { ticker: string; profile: Profile | null }[] = [];
  if (subIndustry) {
    list = await ask('sub_industry', subIndustry);
    if (list.length) basis = 'sub_industry';
  }
  if (list.length === 0 && industry) {
    list = await ask('industry', industry);
    if (list.length) basis = 'industry';
  }
  const rows = await Promise.all(
    list.map(async (p) => ({ ...p, bars: await loadRecentDailyBars(p.ticker, 260) })),
  );
  return { basis, rows };
}

/** Every stored dividend for a ticker (up to 200, newest first in the request, oldest first in the result). */
export async function loadDividendHistory(ticker: string): Promise<StoredDividend[]> {
  const rows = check(
    await client()
      .from('dividends')
      .select(
        'ex_dividend_date, record_date, pay_date, declaration_date, cash_amount, split_adjusted_cash_amount, currency, frequency',
      )
      .eq('ticker', ticker)
      .order('ex_dividend_date', { ascending: false })
      .limit(200),
    'dividends',
  ) as Obj[];
  return rows
    .flatMap((r) => {
      const amount = num(r['cash_amount']);
      const ex = str(r['ex_dividend_date']);
      if (amount === null || amount < 0 || !ex) return [];
      const adj = num(r['split_adjusted_cash_amount']);
      return [
        {
          exDividendDate: ex,
          recordDate: str(r['record_date']),
          payDate: str(r['pay_date']),
          declarationDate: str(r['declaration_date']),
          cashAmount: amount,
          splitAdjustedAmount: adj !== null && adj >= 0 ? adj : null,
          currency: str(r['currency']) ?? 'USD',
          frequency: count(r['frequency']),
        },
      ];
    })
    .reverse();
}

export interface StoredArticle {
  id: string;
  publishedAt: string;
  publisher: string;
  title: string;
  url: string;
  tickers: string[];
  sentiment: { ticker: string; label: string }[];
}

const sentimentOf = (v: unknown) =>
  Array.isArray(v)
    ? v.flatMap((s) => {
        const o = obj(s);
        return o && typeof o['ticker'] === 'string' && typeof o['label'] === 'string'
          ? [{ ticker: o['ticker'], label: o['label'] }]
          : [];
      })
    : [];

/** A ticker's stored articles since a time (up to 1,000), newest first. */
export async function loadNewsWindow(
  ticker: string,
  sinceIso: string,
): Promise<{ rows: StoredArticle[]; capped: boolean }> {
  const LIMIT = 1000;
  const rows = check(
    await client()
      .from('news_articles')
      .select('id, published_at, publisher, title, url, tickers, sentiment')
      .contains('tickers', [ticker])
      .gte('published_at', sinceIso)
      .order('published_at', { ascending: false })
      .limit(LIMIT),
    'news_articles',
  ) as Obj[];
  return {
    capped: rows.length >= LIMIT,
    rows: rows.map((r) => ({
      id: String(r['id']),
      publishedAt: new Date(String(r['published_at'])).toISOString(),
      publisher: String(r['publisher'] ?? ''),
      title: String(r['title'] ?? ''),
      url: String(r['url'] ?? ''),
      tickers: Array.isArray(r['tickers']) ? (r['tickers'] as string[]) : [],
      sentiment: sentimentOf(r['sentiment']),
    })),
  };
}

/** Every stored article since a time, for the comparison across Marsad's stored tickers (up to 1,000). */
export async function loadAllNewsSince(
  sinceIso: string,
): Promise<{ rows: { publishedAt: string; sentiment: { ticker: string; label: string }[] }[]; capped: boolean }> {
  const LIMIT = 1000;
  const rows = check(
    await client()
      .from('news_articles')
      .select('published_at, sentiment')
      .gte('published_at', sinceIso)
      .order('published_at', { ascending: false })
      .limit(LIMIT),
    'news_articles',
  ) as Obj[];
  return {
    capped: rows.length >= LIMIT,
    rows: rows.map((r) => ({
      publishedAt: new Date(String(r['published_at'])).toISOString(),
      sentiment: sentimentOf(r['sentiment']),
    })),
  };
}
