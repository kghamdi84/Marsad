/**
 * Screener (`screener-1`, ADR 0048 build plan item 6) over `ticker_daily_summary` rows (`ticker-summary-1`). Pure.
 *
 * A screen is a list of filters, all of which must hold, plus an optional sort on one field.
 * - Filters compare one numeric or boolean summary field: `gte`, `gt`, `lte`, `lt`, `eq`, `between` (inclusive)
 *   and `isNull` / `notNull`.
 * - A row whose filtered field is null is excluded and counted under that field ("missing data"); it never passes.
 *   `isNull` and `notNull` test for the null itself, so they never count as missing data.
 * - The sort puts nulls last in both directions; ties go by ticker.
 *
 * One derived field: `sessions_to_earnings`, the trading days after the row's date up to and including
 * `next_earnings_date`. With a market calendar it skips exchange holidays; without one it counts weekdays.
 *
 * Presets are data, not advice: each name describes its condition only.
 */
import { isTradingDay, type MarketCalendar } from './calendar.js';
import { weekdaysBetween } from './portfolio-check.js';
import type { SummaryField, TickerSummaryRow } from './ticker-summary.js';

export const SCREENER_VERSION = 'screener-1';

type FieldsOfType<V> = {
  [K in SummaryField]-?: TickerSummaryRow[K] extends V ? K : never;
}[SummaryField];

/** Numeric summary columns, plus the derived trading days to the next results date. */
export type ScreenNumericField = FieldsOfType<number | null> | 'sessions_to_earnings';
export type ScreenBooleanField = FieldsOfType<boolean | null>;
export type ScreenField = ScreenNumericField | ScreenBooleanField;

export const SCREEN_NUMERIC_FIELDS = Object.freeze([
  'close',
  'return_1w',
  'return_1m',
  'return_3m',
  'return_ytd',
  'return_1y',
  'high_52w',
  'low_52w',
  'range_position_52w',
  'sma_20',
  'sma_50',
  'sma_200',
  'rsi_14',
  'atr_14_pct',
  'stretch_50_atr',
  'avg_volume_20',
  'volume_ratio_20',
  'avg_dollar_volume_20',
  'rs_spy_63',
  'dividends_ttm',
  'dividend_yield_ttm',
  'analyst_count',
  'analyst_target_mean',
  'pe_ratio',
  'beta',
  'sessions_to_earnings',
] as const satisfies readonly ScreenNumericField[]);

export const SCREEN_BOOLEAN_FIELDS = Object.freeze([
  'above_sma_50',
  'above_sma_200',
] as const satisfies readonly ScreenBooleanField[]);

// Compile-time check that the lists name every field of each type.
const coversNumeric: [Exclude<ScreenNumericField, (typeof SCREEN_NUMERIC_FIELDS)[number]>] extends [
  never,
]
  ? true
  : false = true;
const coversBoolean: [Exclude<ScreenBooleanField, (typeof SCREEN_BOOLEAN_FIELDS)[number]>] extends [
  never,
]
  ? true
  : false = true;
void coversNumeric;
void coversBoolean;

export type ScreenFilter =
  | { field: ScreenNumericField; op: 'gte' | 'gt' | 'lte' | 'lt' | 'eq'; value: number }
  | { field: ScreenNumericField; op: 'between'; value: readonly [number, number] }
  | { field: ScreenBooleanField; op: 'eq'; value: boolean }
  | { field: ScreenField; op: 'isNull' | 'notNull' };

export type ScreenSortField = ScreenNumericField | 'ticker';

export interface ScreenSort {
  field: ScreenSortField;
  dir: 'asc' | 'desc';
}

/** Why a row matched one filter: the filter and the row's value. */
export type ScreenReason = ScreenFilter & { actual: number | boolean | null };

export interface ScreenMatch {
  row: TickerSummaryRow;
  sessionsToEarnings: number | null;
  reasons: ScreenReason[];
}

export type ScreenResult =
  | {
      ok: true;
      formulaVersion: string;
      total: number;
      matched: number;
      /** Rows left out because a filtered field was null (a row is counted once here). */
      excludedMissing: number;
      /** The same, per field (a row null in two filtered fields counts under both). */
      missingByField: Partial<Record<ScreenField, number>>;
      /** Rows with every filtered field present that failed a condition. */
      failed: number;
      /** The distinct session dates of the rows screened, oldest first. */
      dates: string[];
      sort: ScreenSort | null;
      rows: ScreenMatch[];
    }
  | { ok: false; reason: string };

export interface ScreenPreset {
  id: string;
  name: string;
  filters: readonly ScreenFilter[];
  sort: ScreenSort | null;
}

export const SCREEN_PRESETS: readonly ScreenPreset[] = Object.freeze([
  {
    id: 'above-200-day',
    name: 'Above 200-day average',
    filters: [{ field: 'above_sma_200', op: 'eq', value: true }],
    sort: { field: 'ticker', dir: 'asc' },
  },
  {
    id: 'near-52-week-high',
    name: 'Near 52-week high (top 10% of range)',
    filters: [{ field: 'range_position_52w', op: 'gte', value: 0.9 }],
    sort: { field: 'range_position_52w', dir: 'desc' },
  },
  {
    id: 'unusual-volume',
    name: 'Unusual volume (20-day ratio ≥ 2)',
    filters: [{ field: 'volume_ratio_20', op: 'gte', value: 2 }],
    sort: { field: 'volume_ratio_20', dir: 'desc' },
  },
  {
    id: 'pays-dividend',
    name: 'Pays a dividend',
    filters: [{ field: 'dividends_ttm', op: 'gt', value: 0 }],
    sort: { field: 'dividend_yield_ttm', dir: 'desc' },
  },
  {
    id: 'earnings-within-10',
    name: 'Earnings within 10 sessions',
    filters: [{ field: 'sessions_to_earnings', op: 'lte', value: 10 }],
    sort: { field: 'sessions_to_earnings', dir: 'asc' },
  },
] satisfies ScreenPreset[]);

const NUMERIC: ReadonlySet<string> = new Set(SCREEN_NUMERIC_FIELDS);
const BOOLEAN: ReadonlySet<string> = new Set(SCREEN_BOOLEAN_FIELDS);

/** Trading days after `from` up to and including `to`; weekdays when no calendar is given. Null if `to` is earlier. */
export function sessionsBetween(
  from: string,
  to: string,
  calendar?: MarketCalendar,
): number | null {
  if (to < from) return null;
  if (!calendar) return weekdaysBetween(from, to);
  let n = 0;
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = Date.parse(`${from}T00:00:00Z`) + 86_400_000; t <= end; t += 86_400_000)
    if (isTradingDay(new Date(t).toISOString().slice(0, 10), calendar)) n += 1;
  return n;
}

/** Why a filter cannot run, or null when it is valid. Checked at run time too, since filters can come from a URL. */
export function filterProblem(f: ScreenFilter): string | null {
  const field = String(f.field);
  const op = String(f.op);
  const value: unknown = (f as { value?: unknown }).value;
  if (!NUMERIC.has(field) && !BOOLEAN.has(field)) return `unknown field ${field}`;
  if (op === 'isNull' || op === 'notNull') return null;
  if (BOOLEAN.has(field))
    return op === 'eq' && typeof value === 'boolean'
      ? null
      : `${field} takes eq with true or false`;
  const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (op === 'between') {
    if (!Array.isArray(value) || value.length !== 2 || !value.every(isNumber))
      return `${field} between needs two numbers`;
    return (value[0] as number) > (value[1] as number)
      ? `${field} between has its low above its high`
      : null;
  }
  if (!['gte', 'gt', 'lte', 'lt', 'eq'].includes(op)) return `unknown operator ${op}`;
  return isNumber(value) ? null : `${field} ${op} needs a number`;
}

function valueOf(
  row: TickerSummaryRow,
  field: ScreenField,
  toEarnings: number | null,
): number | boolean | null {
  if (field === 'sessions_to_earnings') return toEarnings;
  const v = row[field];
  return typeof v === 'number' && !Number.isFinite(v) ? null : v;
}

function passes(f: ScreenFilter, v: number | boolean | null): boolean {
  switch (f.op) {
    case 'isNull':
      return v === null;
    case 'notNull':
      return v !== null;
    case 'between':
      return typeof v === 'number' && v >= f.value[0] && v <= f.value[1];
    case 'eq':
      return v === f.value;
    case 'gte':
      return typeof v === 'number' && v >= f.value;
    case 'gt':
      return typeof v === 'number' && v > f.value;
    case 'lte':
      return typeof v === 'number' && v <= f.value;
    case 'lt':
      return typeof v === 'number' && v < f.value;
  }
}

/** The rows that pass every filter, sorted, with the reasons each matched and the counts of what was left out. */
export function screen(
  rows: readonly TickerSummaryRow[],
  filters: readonly ScreenFilter[],
  sort: ScreenSort | null = null,
  calendar?: MarketCalendar,
): ScreenResult {
  for (const f of filters) {
    const why = filterProblem(f);
    if (why) return { ok: false, reason: why };
  }
  if (sort && sort.field !== 'ticker' && !NUMERIC.has(sort.field))
    return { ok: false, reason: `cannot sort by ${String(sort.field)}` };

  const missingByField: Partial<Record<ScreenField, number>> = {};
  let excludedMissing = 0;
  let failed = 0;
  const matches: ScreenMatch[] = [];
  for (const row of rows) {
    const toEarnings =
      row.next_earnings_date === null
        ? null
        : sessionsBetween(row.date, row.next_earnings_date, calendar);
    let missing = false;
    let fail = false;
    const reasons: ScreenReason[] = [];
    for (const f of filters) {
      const v = valueOf(row, f.field, toEarnings);
      if (v === null && f.op !== 'isNull' && f.op !== 'notNull') {
        missing = true;
        missingByField[f.field] = (missingByField[f.field] ?? 0) + 1;
        continue;
      }
      if (passes(f, v)) reasons.push({ ...f, actual: v } as ScreenReason);
      else fail = true;
    }
    if (missing) excludedMissing += 1;
    else if (fail) failed += 1;
    else matches.push({ row, sessionsToEarnings: toEarnings, reasons });
  }

  if (sort) {
    const key = (m: ScreenMatch): number | string | null =>
      sort.field === 'ticker'
        ? m.row.ticker
        : (valueOf(m.row, sort.field, m.sessionsToEarnings) as number | null);
    const sign = sort.dir === 'asc' ? 1 : -1;
    matches.sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      if (ka === null && kb === null) return a.row.ticker.localeCompare(b.row.ticker);
      if (ka === null) return 1;
      if (kb === null) return -1;
      const c =
        typeof ka === 'string' ? ka.localeCompare(kb as string) : (ka as number) - (kb as number);
      return c !== 0 ? sign * c : a.row.ticker.localeCompare(b.row.ticker);
    });
  }

  return {
    ok: true,
    formulaVersion: SCREENER_VERSION,
    total: rows.length,
    matched: matches.length,
    excludedMissing,
    missingByField,
    failed,
    dates: [...new Set(rows.map((r) => r.date))].sort(),
    sort,
    rows: matches,
  };
}
