/**
 * The screener's reads and its link format (core `screener-1` over `ticker_daily_summary`, ADR 0048 item 6).
 *
 * Rows: the newest session's `ticker-summary-1` rows. Row-level security decides which a person reads: members the
 * 'tracked' rows (holdings, watchlists, sector funds), the owner also the 'market' rows once the job writes them.
 *
 * Link: `?f=` holds the filters, comma-separated, each `field:op:value` (`between` takes `low_high`, booleans
 * `true` or `false`, `isNull` and `notNull` no value); `?s=` holds the sort as `field:asc` or `field:desc`. Values
 * are core's units (fractions for returns and ratios). A filter that core's `filterProblem` rejects is dropped and
 * reported, never guessed at.
 */
import {
  SCREEN_BOOLEAN_FIELDS,
  SCREEN_NUMERIC_FIELDS,
  TICKER_SUMMARY_VERSION,
  filterProblem,
  type ScreenFilter,
  type ScreenSort,
} from '@marsad/core';
import { supabase } from './supabase';
import { toSummary, type StoredSummary } from './summary';

function client() {
  if (!supabase) throw new Error('not configured');
  return supabase;
}

const PAGE = 1000;
/** Pages read at most: 10,000 rows covers the tracked list and the whole-market snapshot (about 5,000). */
const MAX_PAGES = 10;

/** Every summary row of the newest session this person can read. */
export async function loadScreenRows(): Promise<StoredSummary[]> {
  const newest = await client()
    .from('ticker_daily_summary')
    .select('date')
    .eq('version', TICKER_SUMMARY_VERSION)
    .order('date', { ascending: false })
    .limit(1);
  if (newest.error) throw new Error(`ticker_daily_summary: ${newest.error.message}`);
  const date = (newest.data?.[0] as { date?: string } | undefined)?.date;
  if (!date) return [];
  const out: StoredSummary[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const r = await client()
      .from('ticker_daily_summary')
      .select('*')
      .eq('version', TICKER_SUMMARY_VERSION)
      .eq('date', date)
      .order('ticker', { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (r.error) throw new Error(`ticker_daily_summary: ${r.error.message}`);
    const rows = (r.data ?? []) as Record<string, unknown>[];
    out.push(...rows.map(toSummary));
    if (rows.length < PAGE) break;
  }
  return out;
}

const NUMERIC: ReadonlySet<string> = new Set(SCREEN_NUMERIC_FIELDS);
const BOOLEAN: ReadonlySet<string> = new Set(SCREEN_BOOLEAN_FIELDS);

/** A filter's value: a number, a boolean, a [low, high] pair, or undefined for `isNull` and `notNull`. */
export const valueOf = (
  f: ScreenFilter,
): number | boolean | readonly [number, number] | undefined =>
  (f as { value?: number | boolean | readonly [number, number] }).value;

/** One filter as link text. */
export function filterText(f: ScreenFilter): string {
  const v = valueOf(f);
  if (v === undefined) return `${f.field}:${f.op}`;
  if (Array.isArray(v)) return `${f.field}:between:${v[0]}_${v[1]}`;
  return `${f.field}:${f.op}:${String(v)}`;
}

export const encodeFilters = (fs: readonly ScreenFilter[]) => fs.map(filterText).join(',');
export const encodeSort = (s: ScreenSort | null) => (s ? `${s.field}:${s.dir}` : '');

/** The filters in a link, and the reason for each part that was dropped. */
export function decodeFilters(text: string | undefined): {
  filters: ScreenFilter[];
  ignored: string[];
} {
  const filters: ScreenFilter[] = [];
  const ignored: string[] = [];
  for (const part of (text ?? '').split(',').filter((p) => p.trim() !== '')) {
    const [field = '', op = '', raw] = part.split(':');
    let f: unknown;
    if (op === 'isNull' || op === 'notNull') f = { field, op };
    else if (op === 'between') {
      const [lo, hi] = (raw ?? '').split('_');
      f = { field, op, value: [num(lo), num(hi)] };
    } else if (BOOLEAN.has(field))
      f = { field, op, value: raw === 'true' ? true : raw === 'false' ? false : raw };
    else f = { field, op, value: num(raw) };
    const why = filterProblem(f as ScreenFilter);
    if (why) ignored.push(why);
    else filters.push(f as ScreenFilter);
  }
  return { filters, ignored };
}

/** The sort in a link; null when absent or not a sortable field. */
export function decodeSort(text: string | undefined): ScreenSort | null {
  const [field = '', dir = ''] = (text ?? '').split(':');
  if (dir !== 'asc' && dir !== 'desc') return null;
  if (field !== 'ticker' && !NUMERIC.has(field)) return null;
  return { field: field as ScreenSort['field'], dir };
}

function num(v: string | undefined): number {
  if (v === undefined || v.trim() === '') return Number.NaN;
  return Number(v);
}
