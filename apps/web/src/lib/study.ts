import {
  buildCalendar,
  lastCompletedTradingDay,
  type DailyBar,
  type FilingEvent,
  type SplitEvent,
  type UpcomingRow,
} from '@marsad/core';
import { supabase } from './supabase';

export interface FilingRow {
  accession: string;
  form: string;
  filingDate: string;
  acceptedAt: string | null;
  primaryDocument: string | null;
  items: string[];
}

export interface StudyData {
  ticker: string;
  company: { name: string | null; cik: string } | null;
  bars: DailyBar[];
  filings: FilingRow[];
  splits: SplitEvent[];
  /** The latest session that has finished, from the market calendar. Null if it cannot be worked out. */
  lastCompletedDay: string | null;
}

function unwrap<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

/** Loads everything the Study page shows for one ticker. Every read goes through row-level security. */
export async function loadStudy(ticker: string): Promise<StudyData> {
  if (!supabase) throw new Error('not configured');
  const [barsR, instR, splitsR, holidaysR] = await Promise.all([
    supabase
      .from('daily_bars')
      .select('date, open, high, low, close, volume, vwap')
      .eq('ticker', ticker)
      .order('date', { ascending: true })
      .limit(1000),
    supabase.from('instruments').select('cik, name').eq('ticker', ticker).maybeSingle(),
    supabase.from('splits').select('execution_date, split_from, split_to').eq('ticker', ticker),
    supabase.from('market_holidays').select('*').eq('exchange', 'NYSE'),
  ]);
  const barRows = unwrap(barsR, 'daily_bars') as Record<string, unknown>[];
  const inst = unwrap(instR, 'instruments') as { cik: string; name: string | null } | null;
  const splitRows = unwrap(splitsR, 'splits') as Record<string, unknown>[];
  const holidayRows = unwrap(holidaysR, 'market_holidays') as Record<string, unknown>[];

  let filings: FilingRow[] = [];
  if (inst) {
    const f = await supabase
      .from('filings')
      .select('accession, form, filing_date, accepted_at, primary_document, items')
      .eq('cik', inst.cik)
      .order('filing_date', { ascending: false })
      .order('accepted_at', { ascending: false })
      .limit(200);
    filings = (unwrap(f, 'filings') as Record<string, unknown>[]).map((r) => ({
      accession: String(r['accession']),
      form: String(r['form']),
      filingDate: String(r['filing_date']),
      acceptedAt: r['accepted_at'] ? String(r['accepted_at']) : null,
      primaryDocument: r['primary_document'] ? String(r['primary_document']) : null,
      items: Array.isArray(r['items']) ? (r['items'] as string[]) : [],
    }));
  }

  const rows: UpcomingRow[] = holidayRows.map((h) => ({
    date: String(h['date']),
    exchange: String(h['exchange']),
    name: String(h['name']),
    status: String(h['status']),
    ...(h['open_at'] ? { open: String(h['open_at']) } : {}),
    ...(h['close_at'] ? { close: String(h['close_at']) } : {}),
  }));

  return {
    ticker,
    company: inst ? { name: inst.name, cik: inst.cik } : null,
    bars: barRows.map((b) => ({
      date: String(b['date']),
      open: Number(b['open']),
      high: Number(b['high']),
      low: Number(b['low']),
      close: Number(b['close']),
      volume: Number(b['volume']),
      vwap: b['vwap'] === null || b['vwap'] === undefined ? null : Number(b['vwap']),
    })),
    filings,
    splits: splitRows.map((s) => ({
      executionDate: String(s['execution_date']),
      splitFrom: Number(s['split_from']),
      splitTo: Number(s['split_to']),
    })),
    lastCompletedDay: lastCompletedTradingDay(new Date(), buildCalendar(rows, 'NYSE')),
  };
}

export function filingEvents(
  filings: readonly {
    form: string;
    filingDate: string;
    acceptedAt: string | null;
    items: readonly string[];
  }[],
): FilingEvent[] {
  return filings.map((f) => ({
    form: f.form,
    filingDate: f.filingDate,
    acceptedAt: f.acceptedAt,
    items: f.items,
  }));
}

/** The SEC page of a filing document. The CIK in the path has no leading zeros. */
export function secUrl(cik: string, f: FilingRow): string | null {
  if (!f.primaryDocument) return null;
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${f.accession.replace(/-/g, '')}/${f.primaryDocument}`;
}
