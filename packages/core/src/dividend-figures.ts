/**
 * Dividend figures (`dividends-1`) from the stored Massive dividend rows. Amounts use the split-adjusted cash
 * amount when the row has one, so payments before and after a split compare on today's share basis.
 *
 * - Next ex-date: the earliest stored ex-date on or after today.
 * - Frequency: the newest row's stated frequency (payments a year); without one, inferred from the median gap
 *   between the newest five ex-dates (under 45 days monthly, under 120 quarterly, under 240 semi-annual, else
 *   annual).
 * - Yield: trailing 12-month dividends over the last stored close (dividend-yield-ttm-1).
 * - Payout ratio: trailing 12-month dividends over trailing four-quarter diluted EPS; null unless EPS is positive.
 * - Cut flags: a regular payment below the regular payment before it (split-adjusted).
 * - Consecutive years of growth: calendar-year totals, counted back from the newest complete year while each year
 *   is above the one before. The oldest stored year counts only when it has as many payments as the frequency,
 *   since stored history may start mid-year; when the count stops at the start of stored history it is a minimum.
 */
import { trailingDividendYield } from './research-figures.js';

export const DIVIDENDS_VERSION = 'dividends-1';

export interface StoredDividend {
  exDividendDate: string;
  recordDate: string | null;
  payDate: string | null;
  declarationDate: string | null;
  /** As paid. */
  cashAmount: number;
  /** On today's share basis; null when the vendor gives none. */
  splitAdjustedAmount: number | null;
  currency: string;
  /** Payments a year as the vendor states it (12, 4, 2, 1; 0 for a one-off), or null. */
  frequency: number | null;
}

export interface DividendSummary {
  formulaVersion: string;
  next: StoredDividend | null;
  latest: StoredDividend | null;
  frequency: number | null;
  frequencySource: 'stated' | 'inferred' | null;
  yield: { pct: number; total: number; count: number; from: string; closeDate: string } | null;
  payoutPct: number | null;
  growth: {
    years: number;
    /** The newest complete calendar year in the count. */
    through: number | null;
    /** True when the count ran into the start of stored history, so the real streak may be longer. */
    atLeast: boolean;
  };
  /** Calendar-year totals, oldest first. */
  annual: { year: number; total: number; count: number }[];
  /** The oldest stored ex-date. */
  historyFrom: string | null;
  /** Regular payments (not one-offs) smaller than the regular payment before them, split-adjusted, oldest first. */
  cuts: { exDividendDate: string; amount: number; previous: number; changePct: number }[];
}

const DAY = 86_400_000;
const days = (d: string) => Date.parse(`${d}T00:00:00Z`) / DAY;

/** The amount on today's share basis. */
export const adjustedAmount = (d: StoredDividend): number => d.splitAdjustedAmount ?? d.cashAmount;

export function inferFrequency(exDates: readonly string[]): number | null {
  const s = [...exDates].sort().slice(-5);
  if (s.length < 2) return null;
  const gaps = s.slice(1).map((d, i) => days(d) - days(s[i] as string));
  gaps.sort((a, b) => a - b);
  const mid =
    gaps.length % 2
      ? (gaps[(gaps.length - 1) / 2] as number)
      : ((gaps[gaps.length / 2 - 1] as number) + (gaps[gaps.length / 2] as number)) / 2;
  return mid < 45 ? 12 : mid < 120 ? 4 : mid < 240 ? 2 : 1;
}

/** Payments cut against the payment before (split-adjusted, US dollars, one-offs left out). */
function cutsOf(rows: readonly StoredDividend[]): DividendSummary['cuts'] {
  const regular = rows.filter((d) => d.currency === 'USD' && d.frequency !== 0);
  const out: DividendSummary['cuts'] = [];
  for (let i = 1; i < regular.length; i += 1) {
    const prev = adjustedAmount(regular[i - 1] as StoredDividend);
    const cur = adjustedAmount(regular[i] as StoredDividend);
    if (prev > 0 && cur < prev - 1e-9)
      out.push({
        exDividendDate: (regular[i] as StoredDividend).exDividendDate,
        amount: cur,
        previous: prev,
        changePct: (cur / prev - 1) * 100,
      });
  }
  return out;
}

export function dividendSummary(input: {
  dividends: readonly StoredDividend[];
  close: number | null;
  closeDate: string | null;
  today: string;
  /** Trailing four-quarter diluted EPS, or null. */
  epsTtm: number | null;
}): DividendSummary {
  const rows = [...input.dividends]
    .filter((d) => Number.isFinite(d.cashAmount))
    .sort((a, b) => a.exDividendDate.localeCompare(b.exDividendDate));
  const latest = rows.at(-1) ?? null;
  const next = rows.find((d) => d.exDividendDate >= input.today) ?? null;
  const stated = latest?.frequency ?? null;
  const frequency =
    stated !== null && stated > 0 ? stated : inferFrequency(rows.map((r) => r.exDividendDate));
  const frequencySource =
    stated !== null && stated > 0 ? 'stated' : frequency === null ? null : 'inferred';

  const adjusted = rows.map((d) => ({
    exDividendDate: d.exDividendDate,
    cashAmount: adjustedAmount(d),
    currency: d.currency,
  }));
  const y =
    input.closeDate === null ? null : trailingDividendYield(adjusted, input.close, input.closeDate);
  const yieldOut = y && input.closeDate ? { ...y, closeDate: input.closeDate } : null;
  const payoutPct =
    y && input.epsTtm !== null && input.epsTtm > 0 ? (y.total / input.epsTtm) * 100 : null;

  const byYear = new Map<number, { total: number; count: number }>();
  for (const d of rows) {
    if (d.currency !== 'USD') continue;
    const yr = Number(d.exDividendDate.slice(0, 4));
    const cur = byYear.get(yr) ?? { total: 0, count: 0 };
    cur.total += adjustedAmount(d);
    cur.count += 1;
    byYear.set(yr, cur);
  }
  const annual = [...byYear.entries()]
    .map(([year, v]) => ({ year, ...v }))
    .sort((a, b) => a.year - b.year);
  const thisYear = Number(input.today.slice(0, 4));
  const oldest = annual[0];
  const firstFull =
    oldest && frequency !== null && oldest.count >= frequency
      ? oldest.year
      : (oldest?.year ?? 0) + 1;
  const complete = annual.filter((a) => a.year < thisYear && a.year >= firstFull);
  let years = 0;
  let atLeast = false;
  const newest = complete.at(-1);
  for (let i = complete.length - 1; i >= 0; i -= 1) {
    const cur = complete[i] as { year: number; total: number };
    const prev = complete[i - 1];
    if (!prev) {
      atLeast = true;
      break;
    }
    if (prev.year !== cur.year - 1 || cur.total <= prev.total + 1e-9) break;
    years += 1;
  }
  return {
    formulaVersion: DIVIDENDS_VERSION,
    next,
    latest,
    frequency,
    frequencySource,
    yield: yieldOut,
    payoutPct,
    growth: {
      years,
      through: years > 0 && newest ? newest.year : null,
      atLeast: years > 0 && atLeast,
    },
    annual,
    historyFrom: rows[0]?.exDividendDate ?? null,
    cuts: cutsOf(rows),
  };
}
