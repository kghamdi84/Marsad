import type {
  AlertEvent,
  DatedSection,
  DividendEvent,
  EarningsFiling,
  FinancialFact,
  HaltEvent,
  NewsItem,
} from '@marsad/core';
import { supabase } from './supabase';

/**
 * Chart events for one ticker that are not filings: trading halts (newest 50) and Marsad's own delivered alerts
 * (newest 50, suppressed signals left out). Loaded on their own: a failure leaves the chart without these markers.
 */
export async function loadChartEvents(
  ticker: string,
): Promise<{ halts: HaltEvent[]; alerts: AlertEvent[] }> {
  const [h, a] = await Promise.all([
    client()
      .from('halts')
      .select('halted_at, reason_code, reason_meaning')
      .eq('symbol', ticker)
      .order('halted_at', { ascending: false })
      .limit(50),
    client()
      .from('alerts')
      .select('created_at, headline')
      .eq('ticker', ticker)
      .neq('decision', 'suppress')
      .order('created_at', { ascending: false })
      .limit(50),
  ]);
  const halts = check(h, 'halts') as Record<string, unknown>[];
  const alerts = check(a, 'alerts') as Record<string, unknown>[];
  return {
    halts: halts.map((r) => ({
      haltedAt: new Date(String(r['halted_at'])).toISOString(),
      reason: r['reason_meaning']
        ? `${String(r['reason_code'])} (${String(r['reason_meaning'])})`
        : String(r['reason_code']),
    })),
    alerts: alerts.map((r) => ({
      createdAt: new Date(String(r['created_at'])).toISOString(),
      headline: String(r['headline']),
    })),
  };
}

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
  /** The filing type: 4, 5, 4/A or 5/A. */
  form: string;
  isAmendment: boolean;
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

export interface HoldingRow {
  table: 'non-derivative' | 'derivative';
  securityTitle: string;
  shares: number | null;
  ownership: 'D' | 'I' | null;
  nature: string | null;
  exercisePrice: number | null;
  expirationDate: string | null;
  underlyingTitle: string | null;
  underlyingShares: number | null;
  footnotes: string[];
}

/** One Form 3 (initial holdings) or 3/A, with its holdings table. */
export interface Form3Filing {
  accession: string;
  form: string;
  isAmendment: boolean;
  originalSubmission: string | null;
  ownerName: string;
  coOwners: string[];
  isDirector: boolean;
  isOfficer: boolean;
  officerTitle: string | null;
  isTenPercentOwner: boolean;
  /** The date that made the person an insider (the report's "event date"). */
  eventDate: string;
  filedAt: string | null;
  /** True when the filing states the person owns no securities. */
  noSecuritiesOwned: boolean | null;
  holdings: HoldingRow[];
}

export interface InsiderData {
  rows: InsiderRow[];
  /** Initial-holdings reports, newest first. */
  form3: Form3Filing[];
  /** Filings the job could not read. Shown, never hidden. */
  unreadable: number;
}

const IS_FORM3 = (type: unknown) => type === '3' || type === '3/A';

export async function loadInsiders(cik: string): Promise<InsiderData> {
  const filings = check(
    await client()
      .from('insider_filings')
      .select(
        'accession, status, document_type, owner_name, co_owners, is_director, is_officer, officer_title, is_ten_percent_owner, plan_10b5, filed_at, period_of_report, no_securities_owned, original_submission',
      )
      .eq('issuer_cik', cik)
      .order('period_of_report', { ascending: false, nullsFirst: false })
      .limit(500),
    'insider_filings',
  ) as Record<string, unknown>[];
  const ok = filings.filter((f) => f['status'] === 'ok');
  const unreadable = filings.length - ok.length;
  const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

  // Initial holdings (Form 3): the newest few, with their holdings rows.
  const form3Heads = ok.filter((f) => IS_FORM3(f['document_type'])).slice(0, 12);
  const holdingRows =
    form3Heads.length === 0
      ? []
      : (check(
          await client()
            .from('insider_holdings')
            .select(
              'accession, line, table_kind, security_title, shares, ownership, nature_of_ownership, exercise_price, expiration_date, underlying_title, underlying_shares, footnotes',
            )
            .in(
              'accession',
              form3Heads.map((f) => f['accession'] as string),
            )
            .order('line', { ascending: true }),
          'insider_holdings',
        ) as Record<string, unknown>[]);
  const form3: Form3Filing[] = form3Heads.map((f) => ({
    accession: String(f['accession']),
    form: String(f['document_type']),
    isAmendment: f['document_type'] === '3/A',
    originalSubmission: (f['original_submission'] as string | null) ?? null,
    ownerName: String(f['owner_name'] ?? ''),
    coOwners: Array.isArray(f['co_owners']) ? (f['co_owners'] as string[]) : [],
    isDirector: f['is_director'] === true,
    isOfficer: f['is_officer'] === true,
    officerTitle: (f['officer_title'] as string | null) ?? null,
    isTenPercentOwner: f['is_ten_percent_owner'] === true,
    eventDate: String(f['period_of_report'] ?? ''),
    filedAt: (f['filed_at'] as string | null) ?? null,
    noSecuritiesOwned:
      typeof f['no_securities_owned'] === 'boolean' ? f['no_securities_owned'] : null,
    holdings: holdingRows
      .filter((h) => h['accession'] === f['accession'])
      .map((h) => ({
        table: h['table_kind'] === 'derivative' ? 'derivative' : 'non-derivative',
        securityTitle: String(h['security_title'] ?? ''),
        shares: n(h['shares']),
        ownership: h['ownership'] === 'D' || h['ownership'] === 'I' ? h['ownership'] : null,
        nature: (h['nature_of_ownership'] as string | null) ?? null,
        exercisePrice: n(h['exercise_price']),
        expirationDate: (h['expiration_date'] as string | null) ?? null,
        underlyingTitle: (h['underlying_title'] as string | null) ?? null,
        underlyingShares: n(h['underlying_shares']),
        footnotes: Array.isArray(h['footnotes']) ? (h['footnotes'] as string[]) : [],
      })),
  }));

  // Trades (Forms 4 and 5 and their amendments). The accession list is asked in chunks: a few hundred in one
  // address would be too long for the API.
  const trades = ok.filter((f) => !IS_FORM3(f['document_type']));
  const tx: Record<string, unknown>[] = [];
  for (let i = 0; i < trades.length; i += 100) {
    tx.push(
      ...(check(
        await client()
          .from('insider_transactions')
          .select(
            'accession, line, table_kind, trade_date, code, shares, price_per_share, acquired_disposed, shares_after, value_usd',
          )
          .in(
            'accession',
            trades.slice(i, i + 100).map((f) => f['accession'] as string),
          )
          .order('trade_date', { ascending: false })
          .limit(1000),
        'insider_transactions',
      ) as Record<string, unknown>[]),
    );
  }
  tx.sort((a, b) => String(b['trade_date']).localeCompare(String(a['trade_date'])));
  const head = new Map(trades.map((f) => [f['accession'] as string, f]));
  return {
    unreadable,
    form3,
    rows: tx.slice(0, 1000).map((t) => {
      const f = head.get(t['accession'] as string) as Record<string, unknown>;
      const form = String(f['document_type'] ?? '');
      return {
        accession: String(t['accession']),
        form,
        isAmendment: form.endsWith('/A'),
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

export interface QuarterlySection {
  accession: string;
  filingDate: string;
  filingUrl: string;
  text: string;
  noMaterialChanges: boolean;
}

/** The two newest stored 10-Q risk-factor sections (Part II, Item 1A), newest first. */
export async function loadQuarterlySections(cik: string): Promise<QuarterlySection[]> {
  const rows = check(
    await client()
      .from('quarterly_sections')
      .select('accession, filing_date, filing_url, text, no_material_changes')
      .eq('cik', cik)
      .order('filing_date', { ascending: false })
      .limit(2),
    'quarterly_sections',
  ) as Record<string, unknown>[];
  return rows.map((r) => ({
    accession: String(r['accession']),
    filingDate: String(r['filing_date']),
    filingUrl: String(r['filing_url']),
    text: String(r['text']),
    noMaterialChanges: r['no_material_changes'] === true,
  }));
}

/** The newest stored 10-K business section (Item 1), or null when none is stored. */
export async function loadBusinessSection(cik: string): Promise<DatedSection | null> {
  const rows = check(
    await client()
      .from('annual_sections')
      .select('period_end, filing_date, filing_url, text')
      .eq('cik', cik)
      .eq('section', 'business')
      .order('period_end', { ascending: false })
      .limit(1),
    'annual_sections',
  ) as Record<string, unknown>[];
  const r = rows[0];
  return r
    ? {
        periodEnd: String(r['period_end']),
        filingDate: String(r['filing_date']),
        filingUrl: String(r['filing_url']),
        text: String(r['text']),
      }
    : null;
}

/** The two newest stored 10-K risk-factor sections (about 110 KB of text each), newest fiscal year first. */
export async function loadRiskFactorSections(cik: string): Promise<DatedSection[]> {
  const rows = check(
    await client()
      .from('annual_sections')
      .select('period_end, filing_date, filing_url, text')
      .eq('cik', cik)
      .eq('section', 'risk_factors')
      .order('period_end', { ascending: false })
      .limit(2),
    'annual_sections',
  ) as Record<string, unknown>[];
  return rows.map((r) => ({
    periodEnd: String(r['period_end']),
    filingDate: String(r['filing_date']),
    filingUrl: String(r['filing_url']),
    text: String(r['text']),
  }));
}
