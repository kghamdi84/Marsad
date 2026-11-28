/**
 * Technical analysis table (`technical-analysis-1`) on daily bars, or weekly and monthly bars resampled from them.
 * Marsad stores daily bars only, so there are no intraday timeframes. Every reading follows a stated rule and is
 * bullish, bearish or neutral: a description of the chart, never buy or sell advice.
 *
 * Moving averages: simple and exponential over 5, 10, 20, 50, 100 and 200 bars. Bullish when the last close is
 * above the average, bearish when below, neutral when equal.
 *
 * Indicators and their rules:
 * - RSI 14 (Wilder): above 55 bullish, below 45 bearish, otherwise neutral.
 * - Stochastic (9, 6): %K over 9 bars smoothed by a 6-bar average; above 55 bullish, below 45 bearish.
 * - StochRSI 14: where RSI 14 sits in its own 14-bar range, 0 to 100; above 55 bullish, below 45 bearish.
 * - MACD (12, 26): the line above 0 bullish, below 0 bearish.
 * - ADX 14 (Wilder): under 20 neutral (no trend); otherwise +DI above -DI bullish, below bearish.
 * - Williams %R 14: above -45 bullish, below -55 bearish.
 * - CCI 14: above 50 bullish, below -50 bearish.
 * - ATR 14: measures range, not direction; shown, not counted.
 * - Highs/Lows 14: the close against the midpoint of the 14-bar high and low; above bullish, below bearish.
 * - Ultimate Oscillator (7, 14, 28): above 55 bullish, below 45 bearish.
 * - ROC 12: the percent change over 12 bars; above 0 bullish, below 0 bearish.
 * - Bull/Bear Power 13: (high minus EMA 13) plus (low minus EMA 13); above 0 bullish, below 0 bearish.
 *
 * Gauges count bullish, neutral and bearish readings (moving averages, indicators, and both together). A gauge
 * reads bullish when more than half of its counted readings are bullish, bearish when more than half are
 * bearish, otherwise neutral. A reading that needs more bars than exist is not available and not counted.
 *
 * Pivot points (classic and Fibonacci) come from the last completed session's high, low and close.
 */
import { atr, ema, macd, rsi, sma, type Series } from './indicators.js';
import type { DailyBar } from './study.js';

export const TECHNICAL_ANALYSIS_VERSION = 'technical-analysis-1';
export type Timeframe = 'daily' | 'weekly' | 'monthly';
export type TaReading = 'bullish' | 'bearish' | 'neutral';

const DAY = 86_400_000;
const lastOf = (s: Series): number | null => s.at(-1) ?? null;

/**
 * Weekly (Monday to Friday) or monthly bars from daily bars: the first open, the highest high, the lowest low,
 * the last close and the summed volume. Each bar is dated by its last session, so the newest one may be partial.
 */
export function resampleBars(bars: readonly DailyBar[], tf: Timeframe): DailyBar[] {
  if (tf === 'daily') return [...bars];
  const key = (d: string) => {
    if (tf === 'monthly') return d.slice(0, 7);
    const t = Date.parse(`${d}T00:00:00Z`);
    const dow = (new Date(t).getUTCDay() + 6) % 7; // Monday 0
    return new Date(t - dow * DAY).toISOString().slice(0, 10);
  };
  const out: DailyBar[] = [];
  let k: string | null = null;
  for (const b of bars) {
    const kb = key(b.date);
    const cur = out.at(-1);
    if (kb !== k || !cur) {
      out.push({ ...b, vwap: null });
      k = kb;
    } else {
      cur.date = b.date;
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume += b.volume;
    }
  }
  return out;
}

function windowHigh(h: readonly number[], i: number, n: number): number {
  let m = -Infinity;
  for (let j = i - n + 1; j <= i; j += 1) m = Math.max(m, h[j] as number);
  return m;
}
function windowLow(l: readonly number[], i: number, n: number): number {
  let m = Infinity;
  for (let j = i - n + 1; j <= i; j += 1) m = Math.min(m, l[j] as number);
  return m;
}

/** Slow stochastic %K: raw %K over `k` bars, averaged over `smooth` bars. Null when the range is flat. */
export function stochastic(
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
  k = 9,
  smooth = 6,
): number | null {
  const raw: number[] = [];
  for (let i = close.length - smooth; i < close.length; i += 1) {
    if (i < k - 1) return null;
    const hh = windowHigh(high, i, k);
    const ll = windowLow(low, i, k);
    if (hh === ll) return null;
    raw.push((((close[i] as number) - ll) / (hh - ll)) * 100);
  }
  return raw.length === smooth ? raw.reduce((s, v) => s + v, 0) / smooth : null;
}

/** StochRSI: the last RSI's place in the range of the last `n` RSI values, 0 to 100. Null when flat. */
export function stochRsi(close: readonly number[], n = 14): number | null {
  const r = rsi(close, n).slice(-n);
  if (r.length < n || r.some((x) => x === null)) return null;
  const v = r as number[];
  const hi = Math.max(...v);
  const lo = Math.min(...v);
  return hi === lo ? null : (((v.at(-1) as number) - lo) / (hi - lo)) * 100;
}

/** ADX with +DI and -DI (Wilder smoothing). Needs 2n bars. */
export function adx(
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
  n = 14,
): { adx: number; plusDi: number; minusDi: number } | null {
  if (close.length < 2 * n) return null;
  let sTr = 0;
  let sP = 0;
  let sM = 0;
  const dx: number[] = [];
  let plusDi = 0;
  let minusDi = 0;
  for (let i = 1; i < close.length; i += 1) {
    const up = (high[i] as number) - (high[i - 1] as number);
    const down = (low[i - 1] as number) - (low[i] as number);
    const p = up > down && up > 0 ? up : 0;
    const m = down > up && down > 0 ? down : 0;
    const tr = Math.max(
      (high[i] as number) - (low[i] as number),
      Math.abs((high[i] as number) - (close[i - 1] as number)),
      Math.abs((low[i] as number) - (close[i - 1] as number)),
    );
    if (i <= n) {
      sTr += tr;
      sP += p;
      sM += m;
    } else {
      sTr = sTr - sTr / n + tr;
      sP = sP - sP / n + p;
      sM = sM - sM / n + m;
    }
    if (i >= n) {
      plusDi = sTr === 0 ? 0 : (100 * sP) / sTr;
      minusDi = sTr === 0 ? 0 : (100 * sM) / sTr;
      const sum = plusDi + minusDi;
      dx.push(sum === 0 ? 0 : (100 * Math.abs(plusDi - minusDi)) / sum);
    }
  }
  if (dx.length < n) return null;
  let a = dx.slice(0, n).reduce((s, v) => s + v, 0) / n;
  for (let i = n; i < dx.length; i += 1) a = (a * (n - 1) + (dx[i] as number)) / n;
  return { adx: a, plusDi, minusDi };
}

export function williamsR(
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
  n = 14,
): number | null {
  const i = close.length - 1;
  if (i < n - 1) return null;
  const hh = windowHigh(high, i, n);
  const ll = windowLow(low, i, n);
  return hh === ll ? null : ((hh - (close[i] as number)) / (hh - ll)) * -100;
}

/** Commodity Channel Index: (typical price minus its n-bar mean) over 0.015 times the mean absolute deviation. */
export function cci(
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
  n = 14,
): number | null {
  if (close.length < n) return null;
  const tp = close.map((c, i) => ((high[i] as number) + (low[i] as number) + c) / 3).slice(-n);
  const mean = tp.reduce((s, v) => s + v, 0) / n;
  const md = tp.reduce((s, v) => s + Math.abs(v - mean), 0) / n;
  return md === 0 ? null : ((tp.at(-1) as number) - mean) / (0.015 * md);
}

/** Ultimate Oscillator (Williams) over 7, 14 and 28 bars. */
export function ultimateOscillator(
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
): number | null {
  if (close.length < 29) return null;
  const bp: number[] = [];
  const tr: number[] = [];
  for (let i = 1; i < close.length; i += 1) {
    const pc = close[i - 1] as number;
    bp.push((close[i] as number) - Math.min(low[i] as number, pc));
    tr.push(Math.max(high[i] as number, pc) - Math.min(low[i] as number, pc));
  }
  const avg = (n: number) => {
    const t = tr.slice(-n).reduce((s, v) => s + v, 0);
    return t === 0 ? null : bp.slice(-n).reduce((s, v) => s + v, 0) / t;
  };
  const a7 = avg(7);
  const a14 = avg(14);
  const a28 = avg(28);
  return a7 === null || a14 === null || a28 === null ? null : (100 * (4 * a7 + 2 * a14 + a28)) / 7;
}

export function roc(close: readonly number[], n = 12): number | null {
  if (close.length < n + 1) return null;
  const base = close[close.length - 1 - n] as number;
  return base > 0 ? ((close.at(-1) as number) / base - 1) * 100 : null;
}

/** Elder's bull power plus bear power: (high minus EMA) plus (low minus EMA). */
export function bullBearPower(
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
  n = 13,
): number | null {
  const e = lastOf(ema(close, n));
  return e === null ? null : (high.at(-1) as number) - e + ((low.at(-1) as number) - e);
}

/** The close against the midpoint of the n-bar high and low. */
export function highsLows(
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
  n = 14,
): number | null {
  const i = close.length - 1;
  if (i < n - 1) return null;
  return (close[i] as number) - (windowHigh(high, i, n) + windowLow(low, i, n)) / 2;
}

/**
 * Bollinger Bands: the n-bar simple average and that average plus and minus k population standard deviations
 * (`bollinger@1`). Null where fewer than n bars exist.
 */
export function bollinger(
  close: readonly number[],
  n = 20,
  k = 2,
): { middle: Series; upper: Series; lower: Series } {
  const middle = sma(close, n);
  const upper: Series = [];
  const lower: Series = [];
  close.forEach((_, i) => {
    const m = middle[i];
    if (m === null || m === undefined) {
      upper.push(null);
      lower.push(null);
      return;
    }
    let ss = 0;
    for (let j = i - n + 1; j <= i; j += 1) ss += ((close[j] as number) - m) ** 2;
    const sd = Math.sqrt(ss / n);
    upper.push(m + k * sd);
    lower.push(m - k * sd);
  });
  return { middle, upper, lower };
}

export interface Pivots {
  s3: number;
  s2: number;
  s1: number;
  p: number;
  r1: number;
  r2: number;
  r3: number;
}

export function pivotPoints(
  h: number,
  l: number,
  c: number,
): { classic: Pivots; fibonacci: Pivots } {
  const p = (h + l + c) / 3;
  const r = h - l;
  return {
    classic: {
      s3: l - 2 * (h - p),
      s2: p - r,
      s1: 2 * p - h,
      p,
      r1: 2 * p - l,
      r2: p + r,
      r3: h + 2 * (p - l),
    },
    fibonacci: {
      s3: p - r,
      s2: p - 0.618 * r,
      s1: p - 0.382 * r,
      p,
      r1: p + 0.382 * r,
      r2: p + 0.618 * r,
      r3: p + r,
    },
  };
}

export const MA_PERIODS = [5, 10, 20, 50, 100, 200] as const;
export type IndicatorId =
  | 'rsi14'
  | 'stoch'
  | 'stochrsi'
  | 'macd'
  | 'adx'
  | 'williams'
  | 'cci'
  | 'atr'
  | 'highslows'
  | 'uo'
  | 'roc'
  | 'bbp';

export interface MaRow {
  period: number;
  simple: number | null;
  simpleReading: TaReading | null;
  exponential: number | null;
  exponentialReading: TaReading | null;
}
export interface IndicatorRow {
  id: IndicatorId;
  value: number | null;
  /** Null when not available, or for ATR (not directional). */
  reading: TaReading | null;
}
export interface Gauge {
  bullish: number;
  neutral: number;
  bearish: number;
  reading: TaReading | null;
}
export interface TechnicalAnalysis {
  formulaVersion: string;
  timeframe: Timeframe;
  /** The last session in the data. */
  asOf: string | null;
  bars: number;
  close: number | null;
  movingAverages: MaRow[];
  indicators: IndicatorRow[];
  gauges: { overall: Gauge; indicators: Gauge; movingAverages: Gauge };
  /** From the last completed session, with its date. */
  pivots: ({ date: string } & ReturnType<typeof pivotPoints>) | null;
}

const band = (v: number | null, lo: number, hi: number): TaReading | null =>
  v === null ? null : v > hi ? 'bullish' : v < lo ? 'bearish' : 'neutral';
const sign = (v: number | null): TaReading | null => band(v, 0, 0);

function gauge(readings: readonly (TaReading | null)[]): Gauge {
  const g = { bullish: 0, neutral: 0, bearish: 0 };
  for (const r of readings) if (r) g[r] += 1;
  const n = g.bullish + g.neutral + g.bearish;
  const reading: TaReading | null =
    n === 0 ? null : g.bullish > n / 2 ? 'bullish' : g.bearish > n / 2 ? 'bearish' : 'neutral';
  return { ...g, reading };
}

export function technicalAnalysis(daily: readonly DailyBar[], tf: Timeframe): TechnicalAnalysis {
  const bars = resampleBars(daily, tf);
  const h = bars.map((b) => b.high);
  const l = bars.map((b) => b.low);
  const c = bars.map((b) => b.close);
  const close = c.at(-1) ?? null;
  const vs = (ma: number | null): TaReading | null =>
    ma === null || close === null
      ? null
      : close > ma
        ? 'bullish'
        : close < ma
          ? 'bearish'
          : 'neutral';

  const movingAverages: MaRow[] = MA_PERIODS.map((period) => {
    const s = lastOf(sma(c, period));
    const e = lastOf(ema(c, period));
    return {
      period,
      simple: s,
      simpleReading: vs(s),
      exponential: e,
      exponentialReading: vs(e),
    };
  });

  const r14 = lastOf(rsi(c, 14));
  const st = stochastic(h, l, c, 9, 6);
  const srsi = stochRsi(c, 14);
  const m = c.length >= 26 ? lastOf(macd(c).line) : null;
  const a = adx(h, l, c, 14);
  const w = williamsR(h, l, c, 14);
  const cc = cci(h, l, c, 14);
  const at = c.length >= 14 ? lastOf(atr(h, l, c, 14)) : null;
  const hl = highsLows(h, l, c, 14);
  const uo = ultimateOscillator(h, l, c);
  const rc = roc(c, 12);
  const bbp = bullBearPower(h, l, c, 13);
  const indicators: IndicatorRow[] = [
    { id: 'rsi14', value: r14, reading: band(r14, 45, 55) },
    { id: 'stoch', value: st, reading: band(st, 45, 55) },
    { id: 'stochrsi', value: srsi, reading: band(srsi, 45, 55) },
    { id: 'macd', value: m, reading: sign(m) },
    {
      id: 'adx',
      value: a ? a.adx : null,
      reading: !a
        ? null
        : a.adx < 20
          ? 'neutral'
          : a.plusDi > a.minusDi
            ? 'bullish'
            : a.plusDi < a.minusDi
              ? 'bearish'
              : 'neutral',
    },
    { id: 'williams', value: w, reading: band(w, -55, -45) },
    { id: 'cci', value: cc, reading: band(cc, -50, 50) },
    { id: 'atr', value: at, reading: null },
    { id: 'highslows', value: hl, reading: sign(hl) },
    { id: 'uo', value: uo, reading: band(uo, 45, 55) },
    { id: 'roc', value: rc, reading: sign(rc) },
    { id: 'bbp', value: bbp, reading: sign(bbp) },
  ];
  const maReadings = movingAverages.flatMap((x) => [x.simpleReading, x.exponentialReading]);
  const indReadings = indicators.map((x) => x.reading);
  const lastDaily = daily.at(-1);
  return {
    formulaVersion: TECHNICAL_ANALYSIS_VERSION,
    timeframe: tf,
    asOf: lastDaily?.date ?? null,
    bars: bars.length,
    close,
    movingAverages,
    indicators,
    gauges: {
      overall: gauge([...maReadings, ...indReadings]),
      indicators: gauge(indReadings),
      movingAverages: gauge(maReadings),
    },
    pivots: lastDaily
      ? { date: lastDaily.date, ...pivotPoints(lastDaily.high, lastDaily.low, lastDaily.close) }
      : null,
  };
}
