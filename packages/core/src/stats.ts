/**
 * Statistics for the backtest lab and risk percentages (ADR 0016, `stats-1`): the normal distribution, the Wilson
 * interval, a seeded percentile bootstrap, trade statistics, the Sharpe ratio, the deflated Sharpe ratio (Bailey and
 * Lopez de Prado, 2014) and drawdowns. Known-answer tests compare with scipy and statsmodels. Pure and seeded: the
 * same inputs and seed give the same output everywhere.
 */

export const STATS_VERSION = 'stats-1';

/** Fewer cases than this show "insufficient history" instead of a percentage (integrity rule 10). */
export const MIN_CASES = 30;

/** Standard normal CDF, double precision (Graeme West, "Better approximations to cumulative normal functions"). */
export function normCdf(x: number): number {
  const z = Math.abs(x);
  let c: number;
  if (z > 37) c = 0;
  else {
    const e = Math.exp((-z * z) / 2);
    if (z < 7.07106781186547) {
      let n = 3.52624965998911e-2 * z + 0.700383064443688;
      n = n * z + 6.37396220353165;
      n = n * z + 33.912866078383;
      n = n * z + 112.079291497871;
      n = n * z + 221.213596169931;
      n = n * z + 220.206867912376;
      let d = 8.83883476483184e-2 * z + 1.75566716318264;
      d = d * z + 16.064177579207;
      d = d * z + 86.7807322029461;
      d = d * z + 296.564248779674;
      d = d * z + 637.333633378831;
      d = d * z + 793.826512519948;
      d = d * z + 440.413735824752;
      c = (e * n) / d;
    } else {
      let d = z + 0.65;
      d = z + 4 / d;
      d = z + 3 / d;
      d = z + 2 / d;
      d = z + 1 / d;
      c = e / d / 2.506628274631;
    }
  }
  return x > 0 ? 1 - c : c;
}

/** Inverse standard normal CDF (Acklam's rational approximation refined by one Halley step). */
export function normInv(p: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError('p must be strictly between 0 and 1');
  const a = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716,
    2.506628277459239,
  ];
  const b = [
    -54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972,
    -13.28068155288572,
  ];
  const c = [
    -0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const [a0, a1, a2, a3, a4, a5] = a as [number, number, number, number, number, number];
  const [b0, b1, b2, b3, b4] = b as [number, number, number, number, number];
  const [c0, c1, c2, c3, c4, c5] = c as [number, number, number, number, number, number];
  const [d0, d1, d2, d3] = d as [number, number, number, number];
  const lo = 0.02425;
  let x: number;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    x =
      (((((c0 * q + c1) * q + c2) * q + c3) * q + c4) * q + c5) /
      ((((d0 * q + d1) * q + d2) * q + d3) * q + 1);
  } else if (p <= 1 - lo) {
    const q = p - 0.5;
    const r = q * q;
    x =
      ((((((a0 * r + a1) * r + a2) * r + a3) * r + a4) * r + a5) * q) /
      (((((b0 * r + b1) * r + b2) * r + b3) * r + b4) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x =
      -(((((c0 * q + c1) * q + c2) * q + c3) * q + c4) * q + c5) /
      ((((d0 * q + d1) * q + d2) * q + d3) * q + 1);
  }
  // One Halley refinement step against the double-precision CDF.
  const e = normCdf(x) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}

export interface Interval {
  low: number;
  high: number;
}

/** Wilson score interval for k successes in n trials at the given two-sided confidence (default 90%). */
export function wilson(k: number, n: number, confidence = 0.9): Interval | null {
  if (n <= 0 || k < 0 || k > n) return null;
  const z = normInv(1 - (1 - confidence) / 2);
  const p = k / n;
  const z2 = z * z;
  const center = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return { low: center - half, high: center + half };
}

/** A seeded 32-bit generator (mulberry32): the same seed gives the same sequence on every runtime. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Linear-interpolation quantile (type 7, as numpy's default) of a sorted array. */
export function quantileSorted(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) throw new RangeError('empty');
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const a = sorted[lo] as number;
  const b = sorted[Math.min(lo + 1, sorted.length - 1)] as number;
  return a + (h - lo) * (b - a);
}

/**
 * Percentile bootstrap interval of `stat` over `values`: `resamples` draws with replacement, seeded. Two-sided at the
 * given confidence (default 90%). Null with fewer than 2 values.
 */
export function bootstrap(
  values: readonly number[],
  stat: (xs: readonly number[]) => number,
  opts: { resamples?: number; seed?: number; confidence?: number } = {},
): Interval | null {
  const n = values.length;
  if (n < 2) return null;
  const rand = mulberry32(opts.seed ?? 1);
  const b = opts.resamples ?? 2000;
  const stats: number[] = [];
  const draw = new Array<number>(n);
  for (let r = 0; r < b; r++) {
    for (let i = 0; i < n; i++) draw[i] = values[Math.floor(rand() * n)] as number;
    stats.push(stat(draw));
  }
  stats.sort((x, y) => x - y);
  const alpha = (1 - (opts.confidence ?? 0.9)) / 2;
  return { low: quantileSorted(stats, alpha), high: quantileSorted(stats, 1 - alpha) };
}

export const mean = (xs: readonly number[]): number =>
  xs.length === 0 ? NaN : xs.reduce((s, x) => s + x, 0) / xs.length;

/** Sample standard deviation (n - 1). */
export function stdev(xs: readonly number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Sample skewness (biased, as scipy.stats.skew with bias=True). */
export function skewness(xs: readonly number[]): number {
  const m = mean(xs);
  const m2 = xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length;
  const m3 = xs.reduce((s, x) => s + (x - m) ** 3, 0) / xs.length;
  return m3 / m2 ** 1.5;
}

/** Kurtosis, not excess (3 for a normal distribution; scipy.stats.kurtosis with fisher=False, bias=True). */
export function kurtosis(xs: readonly number[]): number {
  const m = mean(xs);
  const m2 = xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length;
  const m4 = xs.reduce((s, x) => s + (x - m) ** 4, 0) / xs.length;
  return m4 / (m2 * m2);
}

/** Sharpe ratio per period (mean over sample standard deviation, risk-free 0); times sqrt(periods) to annualize. */
export function sharpe(returns: readonly number[], periodsPerYear = 1): number {
  const s = stdev(returns);
  return s === 0 || Number.isNaN(s) ? NaN : (mean(returns) / s) * Math.sqrt(periodsPerYear);
}

const EULER_GAMMA = 0.5772156649015329;

/**
 * The deflated Sharpe ratio: the probability that the true Sharpe exceeds the best one expected by luck among
 * `trials` variants whose Sharpe ratios vary by `trialsVariance` (all per period, not annualized), given the
 * returns' length, skewness and kurtosis. Bailey and Lopez de Prado, Journal of Portfolio Management, 2014.
 */
export function deflatedSharpe(
  returns: readonly number[],
  trials: number,
  trialsVariance: number,
): { sharpe: number; expectedMax: number; probability: number } {
  const sr = sharpe(returns);
  const t = returns.length;
  const n = Math.max(1, trials);
  const expectedMax =
    n === 1
      ? 0
      : Math.sqrt(trialsVariance) *
        ((1 - EULER_GAMMA) * normInv(1 - 1 / n) + EULER_GAMMA * normInv(1 - 1 / (n * Math.E)));
  const g3 = skewness(returns);
  const g4 = kurtosis(returns);
  const z =
    ((sr - expectedMax) * Math.sqrt(t - 1)) / Math.sqrt(1 - g3 * sr + ((g4 - 1) / 4) * sr * sr);
  return { sharpe: sr, expectedMax, probability: normCdf(z) };
}

/** Largest peak-to-trough fall of the equity curve built by compounding `returns` from 1, as a fraction. */
export function maxDrawdown(returns: readonly number[]): number {
  let equity = 1;
  let peak = 1;
  let worst = 0;
  for (const r of returns) {
    equity *= 1 + r;
    peak = Math.max(peak, equity);
    worst = Math.min(worst, equity / peak - 1);
  }
  return worst;
}

export interface TradeStats {
  n: number;
  winRate: number | null;
  /** Mean return per trade. */
  expectancy: number | null;
  /** Average win over the absolute average loss. */
  payoff: number | null;
  sharpe: number | null;
  maxDrawdown: number | null;
  /** True when n is at least MIN_CASES; below it the page shows "insufficient history". */
  sufficient: boolean;
}

/** Win rate, expectancy, payoff ratio, per-trade Sharpe and maximum drawdown of a list of trade returns. */
export function tradeStats(returns: readonly number[]): TradeStats {
  const n = returns.length;
  if (n === 0)
    return {
      n,
      winRate: null,
      expectancy: null,
      payoff: null,
      sharpe: null,
      maxDrawdown: null,
      sufficient: false,
    };
  const wins = returns.filter((r) => r > 0);
  const losses = returns.filter((r) => r < 0);
  const avgLoss = losses.length > 0 ? Math.abs(mean(losses)) : null;
  const sr = sharpe(returns);
  return {
    n,
    winRate: wins.length / n,
    expectancy: mean(returns),
    payoff: wins.length > 0 && avgLoss ? mean(wins) / avgLoss : null,
    sharpe: Number.isNaN(sr) ? null : sr,
    maxDrawdown: maxDrawdown(returns),
    sufficient: n >= MIN_CASES,
  };
}
