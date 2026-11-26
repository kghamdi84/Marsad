import {
  buildCalendar,
  formatAge,
  quoteFreshness,
  type Freshness,
  type MarketCalendar,
  type TauricQuoteKind,
  type UpcomingRow,
} from '@marsad/core';
import { supabase } from './supabase';

/** Which vendor's latest price the screens show (ADR 0041). Display only: rules and charts stay on Massive. */
export type QuoteSource = 'massive' | 'tauric';

export interface StoredQuote {
  ticker: string;
  price: number;
  change: number | null;
  quoteKind: TauricQuoteKind;
  priceTime: string | null;
  sessionDate: string | null;
  fetchedAt: string;
}

export interface QuoteView {
  source: QuoteSource;
  /** Latest Tauric quotes by ticker; empty when Massive is selected. */
  quotes: Record<string, StoredQuote>;
  /** Tickers Tauric says it does not carry, from the newest successful Tauric job run. */
  notCovered: string[];
  calendar: MarketCalendar;
}

function client() {
  if (!supabase) throw new Error('not configured');
  return supabase;
}

/** The viewer's own choice (Massive until they pick Tauric) and, for Tauric, the stored quotes. */
export async function loadQuoteView(): Promise<QuoteView> {
  const db = client();
  const s = await db.from('user_settings').select('quote_source').maybeSingle();
  if (s.error) throw new Error(`user_settings: ${s.error.message}`);
  const source: QuoteSource = s.data?.['quote_source'] === 'tauric' ? 'tauric' : 'massive';
  if (source === 'massive')
    return { source, quotes: {}, notCovered: [], calendar: buildCalendar([], 'NYSE') };
  const [q, h, runs] = await Promise.all([
    db
      .from('price_quotes')
      .select('ticker, price, change, quote_kind, price_time, session_date, fetched_at')
      .eq('source', 'tauric')
      .limit(200),
    db
      .from('market_holidays')
      .select('date, exchange, name, status, open_at, close_at')
      .eq('exchange', 'NYSE'),
    db
      .from('job_runs')
      .select('details')
      .in('job', ['tauric-quotes', 'tauric-reconcile'])
      .eq('status', 'ok')
      .order('started_at', { ascending: false })
      .limit(1),
  ]);
  if (q.error) throw new Error(`price_quotes: ${q.error.message}`);
  if (h.error) throw new Error(`market_holidays: ${h.error.message}`);
  // The coverage list only refines "No Tauric quote yet" into "Not covered by Tauric"; if it cannot be read, the
  // quotes still show and a missing one keeps the plainer wording.
  const details = runs.error
    ? undefined
    : ((runs.data ?? [])[0] as { details?: { notCovered?: unknown } } | undefined)?.details;
  const notCovered = Array.isArray(details?.notCovered)
    ? details.notCovered.filter((x): x is string => typeof x === 'string')
    : [];
  const quotes: Record<string, StoredQuote> = {};
  for (const r of (q.data ?? []) as Record<string, unknown>[]) {
    const ticker = String(r['ticker']);
    quotes[ticker] = {
      ticker,
      price: Number(r['price']),
      change: r['change'] === null ? null : Number(r['change']),
      quoteKind: r['quote_kind'] as TauricQuoteKind,
      priceTime: (r['price_time'] as string | null) ?? null,
      sessionDate: (r['session_date'] as string | null) ?? null,
      fetchedAt: String(r['fetched_at']),
    };
  }
  const rows: UpcomingRow[] = ((h.data ?? []) as Record<string, string | null>[]).map((x) => ({
    date: String(x['date']),
    exchange: String(x['exchange']),
    name: String(x['name']),
    status: String(x['status']),
    ...(x['open_at'] ? { open: x['open_at'] } : {}),
    ...(x['close_at'] ? { close: x['close_at'] } : {}),
  }));
  return { source, quotes, notCovered, calendar: buildCalendar(rows, 'NYSE') };
}

export async function saveQuoteSource(source: QuoteSource): Promise<void> {
  const r = await client()
    .from('user_settings')
    .upsert({ quote_source: source }, { onConflict: 'owner_id' });
  if (r.error) throw new Error(`user_settings: ${r.error.message}`);
}

/**
 * The words under a Tauric price, by Marsad's clock: "Delay not confirmed, 3m 10s old", "Stale, 22m 0s old",
 * "Market closed, last value 16:00 ET" or "End of day, 2026-11-25". Never "Live" (ADR 0041).
 */
export function quoteStatus(q: StoredQuote, view: QuoteView, now: Date): Freshness {
  const f = quoteFreshness(q, now, view.calendar);
  if (f.state === 'delayed' && f.label === 'Delay not confirmed' && f.ageSeconds !== null)
    return { ...f, label: `${f.label}, ${formatAge(f.ageSeconds)} old` };
  return f;
}
