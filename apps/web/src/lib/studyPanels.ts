import type { DividendEvent, EarningsFiling, FinancialFact, NewsItem } from '@marsad/core';
import { supabase } from './supabase';

function client() {
  if (!supabase) throw new Error('not configured');
  return supabase;
}

function check<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

/** Every stored fact for a company. The API returns at most 1,000 rows a request, so this pages. */
export async function loadFacts(cik: string): Promise<FinancialFact[]> {
  const out: FinancialFact[] = [];
  for (let from = 0; ; from += 1000) {
    const r = await client()
      .from('financial_facts')
      .select(
        'taxonomy, concept, unit, period_start, period_end, value, accession, form, fiscal_year, fiscal_period, filed, frame',
      )
      .eq('cik', cik)
      .order('fact_key', { ascending: true })
      .range(from, from + 999);
    const rows = check(r, 'financial_facts') as Record<string, unknown>[];
    for (const f of rows)
      out.push({
        taxonomy: String(f['taxonomy']),
        concept: String(f['concept']),
        unit: String(f['unit']),
        start: f['period_start'] ? String(f['period_start']) : null,
        end: String(f['period_end']),
        value: Number(f['value']),
        accession: String(f['accession']),
        form: String(f['form']),
        fy: typeof f['fiscal_year'] === 'number' ? f['fiscal_year'] : null,
        fp: f['fiscal_period'] ? String(f['fiscal_period']) : null,
        filed: String(f['filed']),
        frame: f['frame'] ? String(f['frame']) : null,
      });
    if (rows.length < 1000) break;
  }
  return out;
}

export interface InsiderRow {
  accession: string;
  ownerName: string;
  isDirector: boolean;
  isOfficer: boolean;
  officerTitle: string | null;
  isTenPercentOwner: boolean;
  plan10b5: boolean | null;
  filedAt: string | null;
  date: string;
  code: string;
  shares: number | null;
  pricePerShare: number | null;
  acquiredDisposed: 'A' | 'D' | null;
  sharesAfter: number | null;
  valueUsd: number | null;
  table: 'non-derivative' | 'derivative';
}

export interface InsiderData {
  rows: InsiderRow[];
  /** Filings the job could not read. Shown, never hidden. */
  unreadable: number;
}

export async function loadInsiders(cik: string): Promise<InsiderData> {
  const filings = check(
    await client()
      .from('insider_filings')
      .select(
        'accession, status, owner_name, is_director, is_officer, officer_title, is_ten_percent_owner, plan_10b5, filed_at, period_of_report',
      )
      .eq('issuer_cik', cik)
      .order('period_of_report', { ascending: false, nullsFirst: false })
      .limit(200),
    'insider_filings',
  ) as Record<string, unknown>[];
  const ok = filings.filter((f) => f['status'] === 'ok');
  const unreadable = filings.length - ok.length;
  if (ok.length === 0) return { rows: [], unreadable };
  const tx = check(
    await client()
      .from('insider_transactions')
      .select(
        'accession, line, table_kind, trade_date, code, shares, price_per_share, acquired_disposed, shares_after, value_usd',
      )
      .in(
        'accession',
        ok.map((f) => f['accession'] as string),
      )
      .order('trade_date', { ascending: false })
      .limit(1000),
    'insider_transactions',
  ) as Record<string, unknown>[];
  const head = new Map(ok.map((f) => [f['accession'] as string, f]));
  const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
  return {
    unreadable,
    rows: tx.map((t) => {
      const f = head.get(t['accession'] as string) as Record<string, unknown>;
      return {
        accession: String(t['accession']),
        ownerName: String(f['owner_name'] ?? ''),
        isDirector: f['is_director'] === true,
        isOfficer: f['is_officer'] === true,
        officerTitle: (f['officer_title'] as string | null) ?? null,
        isTenPercentOwner: f['is_ten_percent_owner'] === true,
        plan10b5: typeof f['plan_10b5'] === 'boolean' ? f['plan_10b5'] : null,
        filedAt: (f['filed_at'] as string | null) ?? null,
        date: String(t['trade_date']),
        code: String(t['code']),
        shares: n(t['shares']),
        pricePerShare: n(t['price_per_share']),
        acquiredDisposed:
          t['acquired_disposed'] === 'A' || t['acquired_disposed'] === 'D'
            ? t['acquired_disposed']
            : null,
        sharesAfter: n(t['shares_after']),
        valueUsd: n(t['value_usd']),
        table: t['table_kind'] === 'derivative' ? 'derivative' : 'non-derivative',
      };
    }),
  };
}

export interface ShortData {
  interest: {
    date: string;
    shortInterest: number;
    avgDailyVolume: number | null;
    daysToCover: number | null;
  }[];
  volume: { date: string; totalVolume: number; shortVolume: number; ratio: number | null }[];
}

export async function loadShortData(ticker: string): Promise<ShortData> {
  const [si, sv] = await Promise.all([
    client()
      .from('short_interest')
      .select('settlement_date, short_interest, avg_daily_volume, days_to_cover')
      .eq('ticker', ticker)
      .order('settlement_date', { ascending: false })
      .limit(8),
    client()
      .from('short_volume')
      .select('date, total_volume, short_volume, short_volume_ratio')
      .eq('ticker', ticker)
      .order('date', { ascending: false })
      .limit(10),
  ]);
  const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
  return {
    interest: (check(si, 'short_interest') as Record<string, unknown>[]).map((r) => ({
      date: String(r['settlement_date']),
      shortInterest: Number(r['short_interest']),
      avgDailyVolume: n(r['avg_daily_volume']),
      daysToCover: n(r['days_to_cover']),
    })),
    volume: (check(sv, 'short_volume') as Record<string, unknown>[]).map((r) => ({
      date: String(r['date']),
      totalVolume: Number(r['total_volume']),
      shortVolume: Number(r['short_volume']),
      ratio: n(r['short_volume_ratio']),
    })),
  };
}

export async function loadDividends(
  ticker: string,
): Promise<(DividendEvent & { payDate: string | null; declarationDate: string | null })[]> {
  const rows = check(
    await client()
      .from('dividends')
      .select('ex_dividend_date, pay_date, declaration_date, cash_amount, currency')
      .eq('ticker', ticker)
      .order('ex_dividend_date', { ascending: false })
      .limit(20),
    'dividends',
  ) as Record<string, unknown>[];
  return rows.map((r) => ({
    exDividendDate: String(r['ex_dividend_date']),
    payDate: (r['pay_date'] as string | null) ?? null,
    declarationDate: (r['declaration_date'] as string | null) ?? null,
    cashAmount: Number(r['cash_amount']),
    currency: String(r['currency'] ?? 'USD'),
  }));
}

export async function loadNews(ticker: string): Promise<NewsItem[]> {
  const rows = check(
    await client()
      .from('news_articles')
      .select('id, published_at, publisher, title, url, tickers')
      .contains('tickers', [ticker])
      .order('published_at', { ascending: false })
      .limit(60),
    'news_articles',
  ) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r['id']),
    publisher: String(r['publisher']),
    title: String(r['title']),
    publishedAt: new Date(String(r['published_at'])).toISOString(),
    url: String(r['url']),
    tickers: Array.isArray(r['tickers']) ? (r['tickers'] as string[]) : [],
  }));
}

/**
 * Every stored 8-K that reports results (Item 2.02), however old. The company page's own filings list keeps only
 * the newest 200 filings, which for a company with many Form 4s can be a few weeks, so earnings asks for these alone.
 */
export async function loadEarningsFilings(cik: string): Promise<EarningsFiling[]> {
  const rows = check(
    await client()
      .from('filings')
      .select('accession, form, filing_date, accepted_at, items')
      .eq('cik', cik)
      .eq('form', '8-K')
      .contains('items', ['2.02'])
      .order('filing_date', { ascending: false })
      .limit(40),
    'filings',
  ) as Record<string, unknown>[];
  return rows.map((r) => ({
    accession: String(r['accession']),
    form: String(r['form']),
    filingDate: String(r['filing_date']),
    acceptedAt: r['accepted_at'] ? String(r['accepted_at']) : null,
    items: Array.isArray(r['items']) ? (r['items'] as string[]) : [],
  }));
}
