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
  stochastic: 'stoch-slow@1',
  stochRsi: 'stochrsi@1',
  adx: 'adx-wilder@1',
  williamsR: 'williams-r@1',
  cci: 'cci@1',
  ultimate: 'ultimate-7-14-28@1',
  roc: 'roc@1',
  bollinger: 'bollinger-population@1',
  bullBearPower: 'elder-power@1',
  highsLows: 'highs-lows-midpoint@1',
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

function windowMax(a: readonly number[], from: number, to: number): number {
  let m = -Infinity;
  for (let j = from; j <= to; j += 1) m = Math.max(m, at(a, j));
  return m;
}
function windowMin(a: readonly number[], from: number, to: number): number {
  let m = Infinity;
  for (let j = from; j <= to; j += 1) m = Math.min(m, at(a, j));
  return m;
}
const nulls = (n: number): Series => new Array<number | null>(n).fill(null);

/**
 * Slow stochastic %K: raw %K = (close - lowest low) / (highest high - lowest low) x 100 over `k` bars, averaged
 * over `smooth` bars. Null where the range is flat or the window is short.
 */
export function stochastic(
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
  k = 9,
  smoothing = 6,
): Series {
  checkPeriod(k);
  checkPeriod(smoothing);
  checkSameLength(high, low, close);
  const raw: Series = close.map((c, i) => {
    if (i < k - 1) return null;
    const hh = windowMax(high, i - k + 1, i);
    const ll = windowMin(low, i - k + 1, i);
    return hh === ll ? null : ((c - ll) / (hh - ll)) * 100;
  });
  return raw.map((_, i) => {
    if (i < k - 1 + smoothing - 1) return null;
    let s = 0;
    for (let j = i - smoothing + 1; j <= i; j += 1) {
      const v = raw[j];
      if (v === null || v === undefined) return null;
      s += v;
    }
    return s / smoothing;
  });
}

/** StochRSI: where RSI sits in the range of its last `period` values, 0 to 100. Null when that range is flat. */
export function stochRsi(close: readonly number[], period = 14): Series {
  const r = rsi(close, period);
  return r.map((v, i) => {
    if (v === null || i < 2 * period - 1) return null;
    const w = r.slice(i - period + 1, i + 1) as number[];
    const hi = Math.max(...w);
    const lo = Math.min(...w);
    return hi === lo ? null : ((v - lo) / (hi - lo)) * 100;
  });
}

/**
 * ADX with +DI and -DI, Wilder smoothing. DI from index `period`, ADX from index 2 x period - 1 (the mean of the
 * first `period` DX values, then Wilder smoothing).
 */
export function adx(
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
  period = 14,
): { adx: Series; plusDi: Series; minusDi: Series } {
  checkPeriod(period);
  checkSameLength(high, low, close);
  const n = close.length;
  const out = { adx: nulls(n), plusDi: nulls(n), minusDi: nulls(n) };
  let sTr = 0;
  let sP = 0;
  let sM = 0;
  const dx: number[] = [];
  let a = 0;
  for (let i = 1; i < n; i += 1) {
    const up = at(high, i) - at(high, i - 1);
    const down = at(low, i - 1) - at(low, i);
    const p = up > down && up > 0 ? up : 0;
    const m = down > up && down > 0 ? down : 0;
    const tr = Math.max(
      at(high, i) - at(low, i),
      Math.abs(at(high, i) - at(close, i - 1)),
      Math.abs(at(low, i) - at(close, i - 1)),
    );
    if (i <= period) {
      sTr += tr;
      sP += p;
      sM += m;
    } else {
      sTr = sTr - sTr / period + tr;
      sP = sP - sP / period + p;
      sM = sM - sM / period + m;
    }
    if (i < period) continue;
    const pdi = sTr === 0 ? 0 : (100 * sP) / sTr;
    const mdi = sTr === 0 ? 0 : (100 * sM) / sTr;
    out.plusDi[i] = pdi;
    out.minusDi[i] = mdi;
    const sum = pdi + mdi;
    dx.push(sum === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / sum);
    if (dx.length === period) {
      a = dx.reduce((s, v) => s + v, 0) / period;
      out.adx[i] = a;
    } else if (dx.length > period) {
      a = (a * (period - 1) + (dx.at(-1) as number)) / period;
      out.adx[i] = a;
    }
  }
  return out;
}

/** Williams %R: (highest high - close) / (highest high - lowest low) x -100 over `period` bars. */
export function williamsR(
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
  period = 14,
): Series {
  checkPeriod(period);
  checkSameLength(high, low, close);
  return close.map((c, i) => {
    if (i < period - 1) return null;
    const hh = windowMax(high, i - period + 1, i);
    const ll = windowMin(low, i - period + 1, i);
    return hh === ll ? null : ((hh - c) / (hh - ll)) * -100;
  });
}

/** Commodity Channel Index: (typical price - its mean) / (0.015 x mean absolute deviation), over `period` bars. */
export function cci(
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
  period = 14,
): Series {
  checkPeriod(period);
  checkSameLength(high, low, close);
  const tp = close.map((c, i) => (at(high, i) + at(low, i) + c) / 3);
  return tp.map((v, i) => {
    if (i < period - 1) return null;
    const m = mean(tp, i - period + 1, i + 1);
    let md = 0;
    for (let j = i - period + 1; j <= i; j += 1) md += Math.abs(at(tp, j) - m);
    md /= period;
    return md === 0 ? null : (v - m) / (0.015 * md);
  });
}

/**
 * Ultimate Oscillator (Williams): buying pressure (close - min(low, previous close)) over true range, averaged
 * over 7, 14 and 28 bars and weighted 4, 2, 1. First value at index 28.
 */
export function ultimateOscillator(
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
  a = 7,
  b = 14,
  c = 28,
): Series {
  checkSameLength(high, low, close);
  const bp: number[] = [0];
  const tr: number[] = [0];
  for (let i = 1; i < close.length; i += 1) {
    const pc = at(close, i - 1);
    bp.push(at(close, i) - Math.min(at(low, i), pc));
    tr.push(Math.max(at(high, i), pc) - Math.min(at(low, i), pc));
  }
  const avg = (i: number, n: number) => {
    let sb = 0;
    let st = 0;
    for (let j = i - n + 1; j <= i; j += 1) {
      sb += at(bp, j);
      st += at(tr, j);
    }
    return st === 0 ? null : sb / st;
  };
  return close.map((_, i) => {
    if (i < c) return null;
    const x = avg(i, a);
    const y = avg(i, b);
    const z = avg(i, c);
    return x === null || y === null || z === null ? null : (100 * (4 * x + 2 * y + z)) / 7;
  });
}

/** Rate of change in percent over `period` bars. */
export function roc(close: readonly number[], period = 12): Series {
  checkPeriod(period);
  return close.map((v, i) => {
    if (i < period) return null;
    const base = at(close, i - period);
    return base > 0 ? (v / base - 1) * 100 : null;
  });
}

/** Bollinger Bands: the `period` SMA and that SMA plus and minus `k` population standard deviations. */
export function bollinger(
  close: readonly number[],
  period = 20,
  k = 2,
): { middle: Series; upper: Series; lower: Series } {
  const middle = sma(close, period);
  const upper = nulls(close.length);
  const lower = nulls(close.length);
  middle.forEach((m, i) => {
    if (m === null) return;
    let ss = 0;
    for (let j = i - period + 1; j <= i; j += 1) ss += (at(close, j) - m) ** 2;
    const sd = Math.sqrt(ss / period);
    upper[i] = m + k * sd;
    lower[i] = m - k * sd;
  });
  return { middle, upper, lower };
}

/** Elder's bull power plus bear power: (high - EMA) + (low - EMA). */
export function bullBearPower(
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
  period = 13,
): Series {
  checkSameLength(high, low, close);
  const e = ema(close, period);
  return e.map((v, i) => (v === null ? null : at(high, i) - v + (at(low, i) - v)));
}

/** The close against the midpoint of the `period`-bar highest high and lowest low. */
export function highsLows(
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
  period = 14,
): Series {
  checkPeriod(period);
  checkSameLength(high, low, close);
  return close.map((c, i) =>
    i < period - 1
      ? null
      : c - (windowMax(high, i - period + 1, i) + windowMin(low, i - period + 1, i)) / 2,
  );
}
