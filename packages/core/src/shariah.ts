/**
 * Shariah screening aid (ADR 0027, `shariah-1`), off by default: debt and cash against a denominator (market
 * capitalization or total assets) with configurable thresholds, from SEC filings. It is labeled a screening aid:
 * the business-activity screen and the non-permissible income ratio cannot be judged from the stored filings, so
 * the verdict is never more than "passes the financial ratios", and Sahm's own label takes precedence. Pure.
 */
import type { FinancialFact } from './adapters/sec-facts.js';

export const SHARIAH_VERSION = 'shariah-1';

export interface ShariahSettings {
  basis: 'market-cap' | 'assets';
  /** Highest allowed debt over the basis (0.33 is 33%). */
  debtMax: number;
  /** Highest allowed cash over the basis. */
  cashMax: number;
}

/** Common published limits are 30% (AAOIFI, market capitalization) and 33% (several index providers). */
export const DEFAULT_SHARIAH: ShariahSettings = {
  basis: 'market-cap',
  debtMax: 0.33,
  cashMax: 0.33,
};

/** Shares outstanding from the newest cover-page value filed on or before `asOf`. */
export function sharesOutstanding(
  facts: readonly FinancialFact[],
  asOf: string,
): { value: number; end: string; filed: string } | null {
  const rows = facts
    .filter(
      (f) =>
        f.taxonomy === 'dei' &&
        f.concept === 'EntityCommonStockSharesOutstanding' &&
        f.filed <= asOf &&
        f.value > 0,
    )
    .sort((a, b) => a.end.localeCompare(b.end) || a.filed.localeCompare(b.filed));
  const last = rows.at(-1);
  return last ? { value: last.value, end: last.end, filed: last.filed } : null;
}

export interface ShariahInput {
  longTermDebt: number | null;
  cash: number | null;
  assets: number | null;
  /** Price times shares outstanding, or null. */
  marketCap: number | null;
}

export interface ShariahRatio {
  name: 'debt' | 'cash';
  value: number | null;
  max: number;
  pass: boolean | null;
}

export interface ShariahResult {
  version: string;
  basis: ShariahSettings['basis'];
  ratios: ShariahRatio[];
  verdict: 'passes-ratios' | 'fails-ratios' | 'unknown';
  /** What the screen cannot see, always shown with it. */
  caveats: string[];
}

export const SHARIAH_CAVEATS = [
  'A screening aid, not a ruling. Sahm’s own Shariah label takes precedence.',
  'Business activity is not screened: the filings stored here do not classify revenue by activity.',
  'Non-permissible income is not screened: filings do not report interest and other impermissible income consistently.',
  'Debt is long-term debt only (short-term borrowings and the current portion are not stored), so the debt ratio can be understated.',
  'Cash is cash and cash equivalents only; interest-bearing securities are not included.',
] as const;

export function shariahScreen(x: ShariahInput, s: ShariahSettings): ShariahResult {
  const base = s.basis === 'market-cap' ? x.marketCap : x.assets;
  const ratio = (v: number | null) =>
    v === null || base === null || !(base > 0) ? null : v / base;
  const one = (name: ShariahRatio['name'], value: number | null, max: number): ShariahRatio => ({
    name,
    value,
    max,
    pass: value === null ? null : value < max,
  });
  const ratios = [
    one('debt', ratio(x.longTermDebt), s.debtMax),
    one('cash', ratio(x.cash), s.cashMax),
  ];
  const verdict = ratios.some((r) => r.pass === false)
    ? 'fails-ratios'
    : ratios.every((r) => r.pass === true)
      ? 'passes-ratios'
      : 'unknown';
  return {
    version: SHARIAH_VERSION,
    basis: s.basis,
    ratios,
    verdict,
    caveats: [...SHARIAH_CAVEATS],
  };
}
