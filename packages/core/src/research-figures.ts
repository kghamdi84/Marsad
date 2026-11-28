/**
 * Code-computed figures for the Study research tab (`research-1`): the move each analyst price target implies
 * from Marsad's last stored close, the stock against SPY from a common start, Marsad's own beta and dividend
 * yield to set beside a vendor's, and the check for when two sources disagree. Vendor data (analyst targets,
 * profile ratios) comes in as numbers; nothing here calls a network.
 */
import type { DailyBar, DividendEvent } from './study.js';

export const RESEARCH_FIGURES_VERSION = 'research-1';
export const BETA_VERSION = 'beta-daily-1y-1';
export const DIVIDEND_YIELD_VERSION = 'dividend-yield-ttm-1';

const DAY = 86_400_000;
const days = (d: string) => Date.parse(`${d}T00:00:00Z`) / DAY;
const finite = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/** Percent move from `close` to `target`, signed (12.5 means +12.5%). Null without a positive close or a target. */
export function impliedMove(
  target: number | null | undefined,
  close: number | null | undefined,
): number | null {
  if (!finite(target) || !finite(close) || close <= 0 || target < 0) return null;
  return (target / close - 1) * 100;
}

export type PerformanceRange = '3m' | '6m' | '1y' | 'ytd' | '3y' | '5y';
export const PERFORMANCE_RANGES: readonly PerformanceRange[] = [
  '3m',
  '6m',
  '1y',
  'ytd',
  '3y',
  '5y',
];
/** Sessions back from the last bar for the fixed ranges. */
export const PERFORMANCE_SESSIONS: Readonly<Record<Exclude<PerformanceRange, 'ytd'>, number>> = {
  '3m': 63,
  '6m': 126,
  '1y': 252,
  '3y': 756,
  '5y': 1260,
};

export interface PerformancePoint {
  date: string;
  /** Percent change from the start close. */
  stock: number;
  /** SPY's percent change from its close on the same start date; null on a day SPY has no bar. */
  spy: number | null;
}

export type RelativePerformance =
  | {
      available: true;
      range: PerformanceRange;
      start: string;
      end: string;
      points: PerformancePoint[];
      stockPct: number;
      /** Null when SPY has no bar on the start or end date. */
      spyPct: number | null;
    }
  | {
      available: false;
      range: PerformanceRange;
      reason: 'short-history' | 'no-bars';
      /** Sessions the range needs and sessions stored (for the "needs n sessions" line). */
      needs: number;
      have: number;
    };

/**
 * The stock and SPY as percent change from the same start: the close `sessions` bars before the last one, or for
 * YTD the last close of the previous calendar year. Unavailable, with the reason, when the bars do not reach back
 * that far: never a shorter range passed off as the longer one.
 */
export function relativePerformance(
  stock: readonly DailyBar[],
  spy: readonly DailyBar[],
  range: PerformanceRange,
): RelativePerformance {
  const last = stock.at(-1);
  if (!last) return { available: false, range, reason: 'no-bars', needs: 1, have: 0 };
  let from: number;
  if (range === 'ytd') {
    const jan1 = `${last.date.slice(0, 4)}-01-01`;
    from = -1;
    for (let i = stock.length - 1; i >= 0; i -= 1)
      if ((stock[i] as DailyBar).date < jan1) {
        from = i;
        break;
      }
    if (from < 0) {
      const inYear = stock.filter((b) => b.date >= jan1).length;
      return {
        available: false,
        range,
        reason: 'short-history',
        needs: inYear + 1,
        have: stock.length,
      };
    }
  } else {
    const n = PERFORMANCE_SESSIONS[range];
    if (stock.length < n + 1)
      return { available: false, range, reason: 'short-history', needs: n + 1, have: stock.length };
    from = stock.length - 1 - n;
  }
  const first = stock[from] as DailyBar;
  const spyBy = new Map(spy.map((b) => [b.date, b.close]));
  const spyStart = spyBy.get(first.date);
  const pct = (v: number, base: number) => (v / base - 1) * 100;
  const points: PerformancePoint[] = stock.slice(from).map((b) => {
    const s = spyBy.get(b.date);
    return {
      date: b.date,
      stock: pct(b.close, first.close),
      spy: spyStart !== undefined && spyStart > 0 && s !== undefined ? pct(s, spyStart) : null,
    };
  });
  const end = points.at(-1) as PerformancePoint;
  return {
    available: true,
    range,
    start: first.date,
    end: last.date,
    points,
    stockPct: end.stock,
    spyPct: end.spy,
  };
}

/**
 * Marsad's beta: the slope of the stock's daily simple returns on SPY's over the newest 252 sessions both have
 * (covariance over SPY's variance). Null with fewer than 200 matched returns. Vendors often use five years of
 * monthly returns, so the two can differ for honest reasons.
 */
export function dailyBeta(
  stock: readonly DailyBar[],
  spy: readonly DailyBar[],
  sessions = 252,
): { value: number; returns: number; from: string; to: string } | null {
  const spyBy = new Map(spy.map((b) => [b.date, b.close]));
  const both = stock.filter((b) => spyBy.has(b.date)).slice(-(sessions + 1));
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 1; i < both.length; i += 1) {
    const a = both[i - 1] as DailyBar;
    const b = both[i] as DailyBar;
    const sa = spyBy.get(a.date) as number;
    const sb = spyBy.get(b.date) as number;
    if (a.close <= 0 || sa <= 0) continue;
    ys.push(b.close / a.close - 1);
    xs.push(sb / sa - 1);
  }
  if (xs.length < 200) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
  const my = ys.reduce((s, v) => s + v, 0) / ys.length;
  let cov = 0;
  let vx = 0;
  for (let i = 0; i < xs.length; i += 1) {
    cov += ((xs[i] as number) - mx) * ((ys[i] as number) - my);
    vx += ((xs[i] as number) - mx) ** 2;
  }
  if (vx === 0) return null;
  return {
    value: cov / vx,
    returns: xs.length,
    from: (both[0] as DailyBar).date,
    to: (both.at(-1) as DailyBar).date,
  };
}

/**
 * Trailing dividend yield in percent: cash dividends with an ex-date in the 365 days to `asOf` over `close`.
 * Null when the close is not positive or a dividend in the window is not in US dollars (no currency guess).
 */
export function trailingDividendYield(
  dividends: readonly DividendEvent[],
  close: number | null,
  asOf: string,
): { pct: number; total: number; count: number; from: string } | null {
  if (!finite(close) || close <= 0) return null;
  const end = days(asOf);
  const from = new Date((end - 364) * DAY).toISOString().slice(0, 10);
  const inWindow = dividends.filter((d) => d.exDividendDate >= from && d.exDividendDate <= asOf);
  if (inWindow.some((d) => d.currency !== 'USD' || !finite(d.cashAmount))) return null;
  const total = inWindow.reduce((s, d) => s + d.cashAmount, 0);
  return { pct: (total / close) * 100, total, count: inWindow.length, from };
}

export interface Tolerance {
  kind: 'relative' | 'absolute';
  /** A fraction for relative (0.05 is 5%), or units of the figure for absolute. */
  value: number;
}

/** The tolerances the research tab states beside each comparison. */
export const RESEARCH_TOLERANCES = {
  marketValue: { kind: 'relative', value: 0.05 },
  beta: { kind: 'absolute', value: 0.3 },
  /** Dividend yield in percentage points. */
  dividendYield: { kind: 'absolute', value: 0.1 },
} as const satisfies Record<string, Tolerance>;

/**
 * Whether two sources disagree by more than the tolerance. Relative tolerance is measured against Marsad's
 * figure. Null when either figure is missing.
 */
export function differsBeyond(
  marsad: number | null | undefined,
  vendor: number | null | undefined,
  tol: Tolerance,
): { differs: boolean; diff: number } | null {
  if (!finite(marsad) || !finite(vendor)) return null;
  const diff = vendor - marsad;
  if (tol.kind === 'absolute') return { differs: Math.abs(diff) > tol.value, diff };
  if (marsad === 0) return { differs: vendor !== 0, diff };
  return { differs: Math.abs(diff / marsad) > tol.value, diff };
}

/** Percent return over the last `sessions` bars, or null without `sessions + 1` bars. */
export function sessionReturn(bars: readonly DailyBar[], sessions: number): number | null {
  if (bars.length < sessions + 1) return null;
  const a = bars[bars.length - 1 - sessions] as DailyBar;
  const b = bars.at(-1) as DailyBar;
  return a.close > 0 ? (b.close / a.close - 1) * 100 : null;
}

export const EPS_HISTORY_VERSION = 'eps-yoy-1';

export interface EpsQuarter {
  end: string;
  value: number | null;
  derived: boolean;
  filed: string | null;
}

export interface EpsYoYRow extends EpsQuarter {
  /** The same quarter a year earlier (ending 350 to 380 days before), or null. */
  prior: EpsQuarter | null;
  changeUsd: number | null;
  /** Percent change; null unless last year's EPS was positive (a change from a loss has no meaningful percent). */
  changePct: number | null;
}

/** Reported diluted EPS by quarter (oldest first) with the same quarter a year earlier and the change. */
export function epsYearOnYear(quarters: readonly EpsQuarter[]): EpsYoYRow[] {
  return quarters.map((q) => {
    const prior =
      quarters.find((p) => {
        const gap = days(q.end) - days(p.end);
        return gap >= 350 && gap <= 380;
      }) ?? null;
    const changeUsd = q.value !== null && prior?.value != null ? q.value - prior.value : null;
    const changePct =
      changeUsd !== null && prior?.value != null && prior.value > 0
        ? (changeUsd / prior.value) * 100
        : null;
    return { ...q, prior, changeUsd, changePct };
  });
}
