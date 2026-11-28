/**
 * Dividend comparison (`dividend-compare-1`, ADR 0048 build plan item 6): the same amount put into several tickers
 * for N years, with DRIP on or off. Pure. It adds no dividend math of its own:
 *
 * - The yield and the payouts a year come from `dividendSummary` (`dividends-1`), whose yield is
 *   `trailingDividendYield` (`dividend-yield-ttm-1`) over the stored price.
 * - The projection is `dividendCalc` (`dividend-calc-1`) with the price and the yield held fixed: start shares are
 *   the amount over the stored price (fractional shares), no dividend growth and no price growth.
 * - Withholding defaults to `DIVIDEND_WITHHOLDING` (the calculator's and the income view's 30%).
 *
 * A fixed-price projection says nothing about what the price did. So every row also carries the trailing 1-year
 * price change and the historical total return over the last 1 and 3 years (252 and 756 sessions) from stored
 * closes plus the dividends paid. A high-yield ticker whose price fell can show a large positive projection and a
 * negative historical return at the same time; both are shown side by side, never one without the other.
 *
 * Historical return, per window: the amount buys shares at the window's first close. Each dividend with an ex-date
 * after that close and on or before the last close pays its split-adjusted amount per share, less withholding.
 * With DRIP the payment buys shares at the close of the ex-date (the first stored session on or after it); without
 * DRIP it is kept as cash, earning nothing. Total return is (shares times the last close, plus cash kept) over the
 * amount, minus 1. Closes must be split-adjusted (as `daily_bars` stores them); dividend amounts use the vendor's
 * split-adjusted amount, else the paid amount times the cumulative split factor (`cumulativeFactor`) of the splits
 * given. Null with a reason when the bars do not reach back far enough: never a shorter window passed off as the
 * longer one.
 */
import { cumulativeFactor, type Split } from './corporate-actions.js';
import { DIVIDEND_CALC_VERSION, PAYOUT_FREQUENCIES, dividendCalc } from './dividend-calc.js';
import { DIVIDENDS_VERSION, dividendSummary, type StoredDividend } from './dividend-figures.js';
import { DIVIDEND_WITHHOLDING } from './portfolio-check.js';
import { PERFORMANCE_SESSIONS } from './research-figures.js';
import type { DailyBar } from './study.js';

export const DIVIDEND_COMPARE_VERSION = 'dividend-compare-1';

/** How the projection is made, returned with every result so the page can state it beside the figures. */
export const DIVIDEND_PROJECTION_METHOD =
  "today's price and yield held fixed; price moves not included";

/** The historical windows, in sessions (the research tab's 1-year and 3-year ranges). */
export const HISTORICAL_SESSIONS = Object.freeze({
  y1: PERFORMANCE_SESSIONS['1y'],
  y3: PERFORMANCE_SESSIONS['3y'],
});

export interface DividendCompareTicker {
  ticker: string;
  /** The stored last close and its session date; null when none is stored. */
  price: number | null;
  priceDate: string | null;
  /** Trailing 1-year price change as a fraction (as `ticker_daily_summary.return_1y`); null when unavailable. */
  priceChange1y: number | null;
  /** Ascending daily bars, split-adjusted. Bars after `priceDate` are not used. */
  bars: readonly DailyBar[];
  /** Stored dividend rows (the same rows `dividends-1` reads). */
  dividends: readonly StoredDividend[];
  /** The ticker's splits, used only for a dividend row without the vendor's split-adjusted amount. */
  splits?: readonly Split[];
}

export interface DividendCompareInput {
  /** The amount put into each ticker, in USD. */
  amount: number;
  /** Whole years, 1 to 30 (the calculator's range). */
  years: number;
  drip: boolean;
  /** Withholding in percent; defaults to `DIVIDEND_WITHHOLDING` times 100. */
  taxPct?: number;
  tickers: readonly DividendCompareTicker[];
}

export interface DividendProjection {
  startShares: number;
  endShares: number;
  /** Income in the final projected year (with the price and yield fixed, year 1 too unless DRIP adds shares). */
  annualIncomeGross: number;
  annualIncomeNet: number;
  dividendsGross: number;
  tax: number;
  dividendsNet: number;
  /** Shares times the fixed price, plus dividends kept as cash when DRIP is off. */
  endBalance: number;
  totalReturnPct: number;
  averageAnnualPct: number;
}

export type HistoricalReturn =
  | {
      available: true;
      sessions: number;
      from: string;
      to: string;
      /** Price plus dividends (net of withholding, reinvested or kept to match DRIP), percent. */
      totalReturnPct: number;
      /** Price alone over the same closes, percent. */
      priceChangePct: number;
      /** Net dividends per start share over the window (before any reinvestment), USD. */
      dividendsNetPerShare: number;
      payments: number;
      endBalance: number;
    }
  | { available: false; sessions: number; reason: string; needs: number; have: number };

export interface DividendCompareRow {
  ticker: string;
  price: number | null;
  priceDate: string | null;
  /** The trailing 1-year price change in percent, shown beside both returns; null when unavailable. */
  priceChange1yPct: number | null;
  /** Trailing 12-month yield in percent from `dividends-1`; null when it cannot be computed. */
  yieldPct: number | null;
  /** Payments in the trailing 12 months and the window's first ex-date bound. */
  yieldPayments: number | null;
  yieldFrom: string | null;
  /** Payments a year from `dividends-1` (stated or inferred); null for a ticker that paid nothing in 12 months. */
  payoutsPerYear: number | null;
  projection: DividendProjection | null;
  /** Why the projection is null. */
  projectionUnavailable: string | null;
  historical: { y1: HistoricalReturn; y3: HistoricalReturn };
}

export type DividendCompareResult =
  | {
      ok: true;
      formulaVersion: string;
      formulaVersions: Record<string, string>;
      method: string;
      amount: number;
      years: number;
      drip: boolean;
      taxPct: number;
      rows: DividendCompareRow[];
    }
  | { ok: false; reason: string };

/** The dividend's amount on today's share basis. */
function basisAmount(d: StoredDividend, ticker: string, splits: readonly Split[]): number {
  if (d.splitAdjustedAmount !== null) return d.splitAdjustedAmount;
  const own = splits.filter((s) => s.ticker === ticker);
  return own.length === 0 ? d.cashAmount : d.cashAmount * cumulativeFactor(d.exDividendDate, own);
}

/** Total return over the last `sessions` bars, price plus dividends, reinvested or kept to match `drip`. */
export function historicalTotalReturn(x: {
  amount: number;
  bars: readonly DailyBar[];
  /** Dividends with amounts already on today's share basis. */
  dividends: readonly { exDividendDate: string; amount: number; currency: string }[];
  sessions: number;
  drip: boolean;
  /** Withholding as a fraction. */
  tax: number;
}): HistoricalReturn {
  const { bars, sessions } = x;
  const needs = sessions + 1;
  if (bars.length < needs)
    return {
      available: false,
      sessions,
      reason: `needs ${needs} sessions of closes, ${bars.length} stored`,
      needs,
      have: bars.length,
    };
  const startIdx = bars.length - 1 - sessions;
  const start = bars[startIdx] as DailyBar;
  const end = bars.at(-1) as DailyBar;
  if (!(start.close > 0) || !(end.close > 0))
    return {
      available: false,
      sessions,
      reason: 'a close in the window is not positive',
      needs,
      have: bars.length,
    };
  const inWindow = x.dividends
    .filter((d) => d.exDividendDate > start.date && d.exDividendDate <= end.date)
    .sort((a, b) => a.exDividendDate.localeCompare(b.exDividendDate));
  const foreign = inWindow.find((d) => d.currency !== 'USD' || !Number.isFinite(d.amount));
  if (foreign)
    return {
      available: false,
      sessions,
      reason: `dividend on ${foreign.exDividendDate} is not a US dollar amount`,
      needs,
      have: bars.length,
    };
  let shares = x.amount / start.close;
  let cash = 0;
  let perShare = 0;
  let j = startIdx + 1;
  for (const d of inWindow) {
    while (j < bars.length && (bars[j] as DailyBar).date < d.exDividendDate) j += 1;
    const bar = bars[j] as DailyBar; // exists: the ex-date is on or before the last bar
    const net = d.amount * (1 - x.tax);
    perShare += net;
    const pay = shares * net;
    if (x.drip && bar.close > 0) shares += pay / bar.close;
    else cash += pay;
  }
  const endBalance = shares * end.close + cash;
  return {
    available: true,
    sessions,
    from: start.date,
    to: end.date,
    totalReturnPct: (endBalance / x.amount - 1) * 100,
    priceChangePct: (end.close / start.close - 1) * 100,
    dividendsNetPerShare: perShare,
    payments: inWindow.length,
    endBalance,
  };
}

function row(
  t: DividendCompareTicker,
  amount: number,
  years: number,
  drip: boolean,
  taxPct: number,
): DividendCompareRow {
  const splits = t.splits ?? [];
  const adjusted: StoredDividend[] = t.dividends.map((d) => ({
    ...d,
    splitAdjustedAmount: basisAmount(d, t.ticker, splits),
  }));
  const asOf = t.priceDate;
  const bars = asOf === null ? t.bars : t.bars.filter((b) => b.date <= asOf); // point in time
  const historicalDivs = adjusted.map((d) => ({
    exDividendDate: d.exDividendDate,
    amount: d.splitAdjustedAmount as number,
    currency: d.currency,
  }));
  const hist = (sessions: number) =>
    historicalTotalReturn({
      amount,
      bars,
      dividends: historicalDivs,
      sessions,
      drip,
      tax: taxPct / 100,
    });
  const out: DividendCompareRow = {
    ticker: t.ticker,
    price: t.price,
    priceDate: t.priceDate,
    priceChange1yPct:
      t.priceChange1y !== null && Number.isFinite(t.priceChange1y) ? t.priceChange1y * 100 : null,
    yieldPct: null,
    yieldPayments: null,
    yieldFrom: null,
    payoutsPerYear: null,
    projection: null,
    projectionUnavailable: null,
    historical: { y1: hist(HISTORICAL_SESSIONS.y1), y3: hist(HISTORICAL_SESSIONS.y3) },
  };
  if (t.price === null || !(t.price > 0) || t.priceDate === null) {
    out.projectionUnavailable = 'no stored price';
    return out;
  }
  const s = dividendSummary({
    dividends: adjusted,
    close: t.price,
    closeDate: t.priceDate,
    today: t.priceDate,
    epsTtm: null,
  });
  if (s.yield === null) {
    out.projectionUnavailable = 'trailing yield unavailable (a dividend is not in US dollars)';
    return out;
  }
  out.yieldPct = s.yield.pct;
  out.yieldPayments = s.yield.count;
  out.yieldFrom = s.yield.from;
  const pays = s.yield.count > 0;
  out.payoutsPerYear = pays ? s.frequency : null;
  if (
    pays &&
    (s.frequency === null || !(PAYOUT_FREQUENCIES as readonly number[]).includes(s.frequency))
  ) {
    out.projectionUnavailable =
      s.frequency === null
        ? 'payouts a year unknown'
        : `payouts a year (${s.frequency}) is not 1, 2, 4 or 12`;
    return out;
  }
  const calc = dividendCalc({
    price: t.price,
    shares: amount / t.price,
    years,
    yieldPct: s.yield.pct,
    // A ticker with no payment in 12 months has a zero yield, so the payout count does not change the result.
    payoutsPerYear: pays ? (s.frequency as number) : 1,
    taxPct,
  });
  if (!calc.ok) {
    out.projectionUnavailable = calc.reason;
    return out;
  }
  const p = drip ? calc.drip : calc.cash;
  const last = p.years.at(-1);
  out.projection = {
    startShares: amount / t.price,
    endShares: last?.sharesEnd ?? amount / t.price,
    annualIncomeGross: p.finalYearGross,
    annualIncomeNet: p.finalYearNet,
    dividendsGross: p.dividendsGross,
    tax: p.tax,
    dividendsNet: p.dividendsNet,
    endBalance: p.endValue + (drip ? 0 : p.dividendsNet),
    totalReturnPct: p.totalReturnPct,
    averageAnnualPct: p.averageAnnualPct,
  };
  return out;
}

/** The comparison across tickers, in the order given. */
export function dividendCompare(input: DividendCompareInput): DividendCompareResult {
  const taxPct = input.taxPct ?? DIVIDEND_WITHHOLDING * 100;
  if (!Number.isFinite(input.amount) || !(input.amount > 0))
    return { ok: false, reason: 'amount must be above zero' };
  if (!Number.isInteger(input.years) || input.years < 1 || input.years > 30)
    return { ok: false, reason: 'holding period must be 1 to 30 whole years' };
  if (!Number.isFinite(taxPct) || taxPct < 0 || taxPct > 100)
    return { ok: false, reason: 'dividend tax must be 0 to 100%' };
  return {
    ok: true,
    formulaVersion: DIVIDEND_COMPARE_VERSION,
    formulaVersions: {
      compare: DIVIDEND_COMPARE_VERSION,
      projection: DIVIDEND_CALC_VERSION,
      dividends: DIVIDENDS_VERSION,
    },
    method: DIVIDEND_PROJECTION_METHOD,
    amount: input.amount,
    years: input.years,
    drip: input.drip,
    taxPct,
    rows: input.tickers.map((t) => row(t, input.amount, input.years, input.drip, taxPct)),
  };
}
