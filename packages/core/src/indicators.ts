/**
 * Technical indicators, pure functions over arrays of numbers.
 *
 * Every function returns an array the same length as its input. Positions before
 * the first computable value are `null`, never 0 and never NaN, so a warm-up gap
 * cannot be mistaken for a real reading. All outputs are checked against golden
 * values from an independent implementation (see indicators.test.ts).
 *
 * Conventions, chosen to match TA-Lib and common charting software:
 * - EMA is seeded with the simple average of the first `period` values, then
 *   y = alpha * x + (1 - alpha) * y_prev with alpha = 2 / (period + 1).
 * - RSI and ATR use Wilder smoothing (alpha = 1 / period), seeded with the simple
 *   average of the first `period` values.
 * - The true range of the first bar is high minus low (no previous close exists).
 * - RVOL compares a bar's volume with the mean of the previous `period` bars,
 *   excluding the bar itself. It is not time-of-day adjusted.
 *
 * Formula versions are in FORMULA_VERSIONS so derived values can cite them.
 */

export type Series = (number | null)[];

export const FORMULA_VERSIONS = {
  sma: 'sma@1',
  ema: 'ema@1',
  rsi: 'rsi-wilder@1',
  atr: 'atr-wilder@1',
  macd: 'macd@1',
  vwap: 'vwap-typical@1',
  rvol: 'rvol-prior-mean@1',
} as const;

function checkPeriod(period: number): void {
  if (!Number.isInteger(period) || period < 1) {
    throw new RangeError(`period must be a positive integer, got ${period}`);
  }
}

function checkSameLength(...arrays: readonly (readonly number[])[]): void {
  const first = arrays[0];
  if (first === undefined) return;
  for (const a of arrays) {
    if (a.length !== first.length) throw new RangeError('input arrays must have the same length');
  }
}

function at(a: readonly number[], i: number): number {
  const v = a[i];
  if (v === undefined) throw new RangeError(`index ${i} out of range`);
  return v;
}

function mean(a: readonly number[], from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += at(a, i);
  return sum / (to - from);
}

/** Simple moving average. */
export function sma(values: readonly number[], period: number): Series {
  checkPeriod(period);
  const out: Series = new Array<number | null>(values.length).fill(null);
  for (let i = period - 1; i < values.length; i += 1) {
    out[i] = mean(values, i - period + 1, i + 1);
  }
  return out;
}

/** Recursion y = alpha * x + (1 - alpha) * y_prev from a seed at `seedIndex`. */
function smooth(values: readonly number[], seedIndex: number, seed: number, alpha: number): Series {
  const out: Series = new Array<number | null>(values.length).fill(null);
  if (seedIndex >= values.length) return out;
  let prev = seed;
  out[seedIndex] = prev;
  for (let i = seedIndex + 1; i < values.length; i += 1) {
    prev = alpha * at(values, i) + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

/** Exponential moving average, seeded with the SMA of the first `period` values. */
export function ema(values: readonly number[], period: number): Series {
  checkPeriod(period);
  if (values.length < period) return new Array<number | null>(values.length).fill(null);
  return smooth(values, period - 1, mean(values, 0, period), 2 / (period + 1));
}

/**
 * Relative strength index with Wilder smoothing. First value at index `period`.
 * When the average loss is 0 the RSI is 100, or 50 if the average gain is 0 too (a flat series).
 */
export function rsi(closes: readonly number[], period = 14): Series {
  checkPeriod(period);
  const out: Series = new Array<number | null>(closes.length).fill(null);
  if (closes.length <= period) return out;
  const gains: number[] = [0];
  const losses: number[] = [0];
  for (let i = 1; i < closes.length; i += 1) {
    const d = at(closes, i) - at(closes, i - 1);
    gains.push(d > 0 ? d : 0);
    losses.push(d < 0 ? -d : 0);
  }
  let avgGain = mean(gains, 1, period + 1);
  let avgLoss = mean(losses, 1, period + 1);
  const toRsi = (g: number, l: number): number => {
    if (l === 0) return g === 0 ? 50 : 100;
    return 100 - 100 / (1 + g / l);
  };
  out[period] = toRsi(avgGain, avgLoss);
  for (let i = period + 1; i < closes.length; i += 1) {
    avgGain = (avgGain * (period - 1) + at(gains, i)) / period;
    avgLoss = (avgLoss * (period - 1) + at(losses, i)) / period;
    out[i] = toRsi(avgGain, avgLoss);
  }
  return out;
}

/** True range: the largest of high-low, |high - previous close|, |low - previous close|. */
export function trueRange(
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
): number[] {
  checkSameLength(high, low, close);
  return high.map((h, i) => {
    const l = at(low, i);
    if (i === 0) return h - l;
    const pc = at(close, i - 1);
    return Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  });
}

/** Average true range with Wilder smoothing. First value at index `period - 1`. */
export function atr(
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
  period = 14,
): Series {
  checkPeriod(period);
  const tr = trueRange(high, low, close);
  if (tr.length < period) return new Array<number | null>(tr.length).fill(null);
  return smooth(tr, period - 1, mean(tr, 0, period), 1 / period);
}

export interface Macd {
  line: Series;
  signal: Series;
  histogram: Series;
}

/** MACD: fast EMA minus slow EMA, its signal EMA, and the histogram (line minus signal). */
export function macd(closes: readonly number[], fast = 12, slow = 26, signalPeriod = 9): Macd {
  checkPeriod(fast);
  checkPeriod(slow);
  checkPeriod(signalPeriod);
  if (fast >= slow) throw new RangeError('fast period must be shorter than slow period');
  const f = ema(closes, fast);
  const s = ema(closes, slow);
  const line: Series = closes.map((_, i) => {
    const a = f[i];
    const b = s[i];
    return a === null || a === undefined || b === null || b === undefined ? null : a - b;
  });
  const first = slow - 1; // first index with a MACD line value
  const values = line.slice(first).map((x) => x ?? 0);
  const signal: Series = new Array<number | null>(closes.length).fill(null);
  const sig = ema(values, signalPeriod);
  sig.forEach((x, k) => {
    signal[first + k] = x;
  });
  const histogram: Series = line.map((x, i) => {
    const sg = signal[i];
    return x === null || sg === null || sg === undefined ? null : x - sg;
  });
  return { line, signal, histogram };
}

/**
 * Volume-weighted average price, cumulative from the first bar: sum(typical * volume) /
 * sum(volume), typical = (high + low + close) / 3. Callers pass one session's bars, so the
 * VWAP resets by construction. Null while cumulative volume is 0.
 */
export function vwap(
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
  volume: readonly number[],
): Series {
  checkSameLength(high, low, close, volume);
  let pv = 0;
  let vol = 0;
  return high.map((h, i) => {
    const v = at(volume, i);
    pv += ((h + at(low, i) + at(close, i)) / 3) * v;
    vol += v;
    return vol === 0 ? null : pv / vol;
  });
}

/** Relative volume: volume divided by the mean volume of the previous `period` bars. */
export function rvol(volume: readonly number[], period = 20): Series {
  checkPeriod(period);
  const out: Series = new Array<number | null>(volume.length).fill(null);
  for (let i = period; i < volume.length; i += 1) {
    const avg = mean(volume, i - period, i);
    out[i] = avg === 0 ? null : at(volume, i) / avg;
  }
  return out;
}

/**
 * Volume-weighted average of per-bar prices: sum(price * volume) / sum(volume). With each bar's own
 * volume-weighted price (a vendor's `vw`) this rebuilds the session VWAP exactly; with typical prices
 * it only approximates it. Null when there is no volume.
 */
export function volumeWeightedPrice(
  prices: readonly number[],
  volume: readonly number[],
): number | null {
  checkSameLength(prices, volume);
  let pv = 0;
  let vol = 0;
  prices.forEach((p, i) => {
    const v = at(volume, i);
    pv += p * v;
    vol += v;
  });
  return vol === 0 ? null : pv / vol;
}
