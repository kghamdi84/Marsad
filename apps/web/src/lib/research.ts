/**
 * Readers for the Study research tab. `company_research` holds the Tauric analyst, profile, thesis and calendar
 * payloads as the research job stored them (ADR 0047); each part read here goes through the same core validator
 * again, and a part that fails is shown as unavailable with its reason.
 */
import {
  researchPartAsOf,
  validateProfile,
  validateResearchPart,
  type DailyBar,
  type ResearchPart,
  type ResearchValue,
  type StoredDividend,
  type TauricAnalyst,
  type TauricCalendar,
  type TauricProfile,
  type TauricThesis,
} from '@marsad/core';
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

/** One part of the research row: validated in core, or the reason it cannot be shown. */
export type Part<T> = { ok: true; value: T; asOf: string | null } | { ok: false; reason: string };

export interface CompanyResearch {
  ticker: string;
  fetchedAt: string | null;
  analyst: Part<TauricAnalyst>;
  profile: Part<TauricProfile>;
  thesis: Part<TauricThesis>;
  calendar: Part<TauricCalendar>;
}

/**
 * A stored part through its core validator (the same one the job ran). A null part says why from the row's
 * errors; a part that fails the check is shown as unavailable with the reason, never in part.
 */
function part<T extends ResearchValue>(
  name: ResearchPart,
  json: unknown,
  ticker: string,
  errors: Obj | null,
): Part<T> {
  if (json === null || json === undefined)
    return { ok: false, reason: str(errors?.[name]) ?? 'not_stored' };
  const r = validateResearchPart(name, json, ticker);
  return r.ok
    ? { ok: true, value: r.value as T, asOf: researchPartAsOf(name, r.value) }
    : { ok: false, reason: r.reason };
}

export function parseResearchRow(r: Obj): CompanyResearch {
  const ticker = String(r['ticker']);
  const errors = obj(r['errors']);
  return {
    ticker,
    fetchedAt: str(r['fetched_at']),
    analyst: part<TauricAnalyst>('analyst', r['analyst'], ticker, errors),
    profile: part<TauricProfile>('profile', r['profile'], ticker, errors),
    thesis: part<TauricThesis>('thesis', r['thesis'], ticker, errors),
    calendar: part<TauricCalendar>('calendar', r['calendar'], ticker, errors),
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
  profile: TauricProfile | null;
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
          .select('ticker, profile')
          .eq(`profile->>${field}`, value)
          .neq('ticker', ticker)
          .order('ticker', { ascending: true })
          .limit(12),
        'company_research',
      ) as Obj[]
    ).map((r) => ({
      ticker: String(r['ticker']),
      profile: (() => {
        const v = validateProfile(r['profile'], String(r['ticker']));
        return v.ok ? v.value : null;
      })(),
    }));
  let basis: 'sub_industry' | 'industry' | null = null;
  let list: { ticker: string; profile: TauricProfile | null }[] = [];
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
export async function loadAllNewsSince(sinceIso: string): Promise<{
  rows: { publishedAt: string; sentiment: { ticker: string; label: string }[] }[];
  capped: boolean;
}> {
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

export interface AnalystDay {
  asOf: string;
  recommendation: string | null;
  strongBuy: number | null;
  buy: number | null;
  hold: number | null;
  sell: number | null;
  strongSell: number | null;
  analysts: number | null;
  targetMean: number | null;
}

/** The stored daily analyst snapshots for a ticker (one a UTC day), oldest first. */
export async function loadAnalystHistory(ticker: string): Promise<AnalystDay[]> {
  const rows = check(
    await client()
      .from('analyst_history')
      .select(
        'as_of, recommendation, strong_buy, buy, hold, sell, strong_sell, number_of_analysts, target_mean',
      )
      .eq('ticker', ticker)
      .order('as_of', { ascending: false })
      .limit(400),
    'analyst_history',
  ) as Obj[];
  return rows
    .flatMap((r) => {
      const asOf = str(r['as_of']);
      if (!asOf) return [];
      const mean = num(r['target_mean']);
      return [
        {
          asOf,
          recommendation: str(r['recommendation']),
          strongBuy: count(r['strong_buy']),
          buy: count(r['buy']),
          hold: count(r['hold']),
          sell: count(r['sell']),
          strongSell: count(r['strong_sell']),
          analysts: count(r['number_of_analysts']),
          targetMean: mean !== null && mean > 0 ? mean : null,
        },
      ];
    })
    .reverse();
}
