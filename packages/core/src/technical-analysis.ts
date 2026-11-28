/**
 * Technical analysis (`technical-1`), the one technical engine: daily bars, or weekly and monthly bars resampled
 * from them (Marsad stores daily bars only, so no intraday timeframes). Every reading follows a rule in
 * TA_RULES and is bullish, bearish or neutral: a description of the chart, never buy or sell advice. The summary
 * ("n of m readings bullish") is the overall gauge of this same table, so the two cannot disagree.
 *
 * Moving averages: simple and exponential over 5, 10, 20, 50, 100 and 200 bars; bullish when the last close is
 * above the average, bearish below, neutral equal.
 *
 * Indicators (series functions in indicators.ts) and their rules:
 * - RSI 14, Stochastic (9, 6), StochRSI 14, Ultimate Oscillator (7, 14, 28): above 55 bullish, below 45 bearish.
 * - MACD (12, 26) line, ROC 12, Bull/Bear Power 13, Highs/Lows 14: above 0 bullish, below 0 bearish.
 * - ADX 14: under 20 neutral (no trend); otherwise +DI above -DI bullish, below bearish.
 * - Williams %R 14: above -45 bullish, below -55 bearish.
 * - CCI 14: above 50 bullish, below -50 bearish.
 * - ATR 14: measures range, not direction; shown, not counted.
 *
 * Gauges count bullish, neutral and bearish readings (moving averages, indicators, both together) and read
 * bullish when more than half of the counted readings are bullish, bearish when more than half are bearish,
 * otherwise neutral. A reading that needs more bars than exist is not available and not counted.
 *
 * Pivot points (classic and Fibonacci) come from the last completed session's high, low and close.
 */
import {
  FORMULA_VERSIONS,
  adx,
  atr,
  bullBearPower,
  cci,
  ema,
  highsLows,
  macd,
  roc,
  rsi,
  sma,
  stochRsi,
  stochastic,
  ultimateOscillator,
  williamsR,
  type Series,
} from './indicators.js';
import type { DailyBar } from './study.js';

export const TECHNICAL_VERSION = 'technical-1';
export type Timeframe = 'daily' | 'weekly' | 'monthly';
export type TaReading = 'bullish' | 'bearish' | 'neutral';

/** Every threshold the readings use, in one place: [bearish below, bullish above]. */
export const TA_RULES = {
  oscillator: [45, 55],
  zero: [0, 0],
  williams: [-55, -45],
  cci: [-50, 50],
  adxTrend: 20,
  gaugeMajority: 0.5,
} as const;

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
  indicatorVersions: string;
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

const band = (v: number | null, [lo, hi]: readonly [number, number]): TaReading | null =>
  v === null ? null : v > hi ? 'bullish' : v < lo ? 'bearish' : 'neutral';

export function gauge(readings: readonly (TaReading | null)[]): Gauge {
  const g = { bullish: 0, neutral: 0, bearish: 0 };
  for (const r of readings) if (r) g[r] += 1;
  const n = g.bullish + g.neutral + g.bearish;
  const m = n * TA_RULES.gaugeMajority;
  const reading: TaReading | null =
    n === 0 ? null : g.bullish > m ? 'bullish' : g.bearish > m ? 'bearish' : 'neutral';
  return { ...g, reading };
}

export function technicalAnalysis(daily: readonly DailyBar[], tf: Timeframe): TechnicalAnalysis {
  for (let i = 1; i < daily.length; i += 1)
    if ((daily[i] as DailyBar).date <= (daily[i - 1] as DailyBar).date)
      throw new RangeError(
        `Bars are not in ascending date order at ${(daily[i] as DailyBar).date}`,
      );
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
    return { period, simple: s, simpleReading: vs(s), exponential: e, exponentialReading: vs(e) };
  });

  const n = c.length;
  const r14 = lastOf(rsi(c, 14));
  const st = lastOf(stochastic(h, l, c, 9, 6));
  const srsi = lastOf(stochRsi(c, 14));
  const m = n >= 26 ? lastOf(macd(c).line) : null;
  const a = adx(h, l, c, 14);
  const ax = lastOf(a.adx);
  const pdi = lastOf(a.plusDi);
  const mdi = lastOf(a.minusDi);
  const w = lastOf(williamsR(h, l, c, 14));
  const cc = lastOf(cci(h, l, c, 14));
  const at = n >= 14 ? lastOf(atr(h, l, c, 14)) : null;
  const hl = lastOf(highsLows(h, l, c, 14));
  const uo = lastOf(ultimateOscillator(h, l, c));
  const rc = lastOf(roc(c, 12));
  const bbp = lastOf(bullBearPower(h, l, c, 13));
  const adxReading: TaReading | null =
    ax === null || pdi === null || mdi === null
      ? null
      : ax < TA_RULES.adxTrend
        ? 'neutral'
        : pdi > mdi
          ? 'bullish'
          : pdi < mdi
            ? 'bearish'
            : 'neutral';
  const indicators: IndicatorRow[] = [
    { id: 'rsi14', value: r14, reading: band(r14, TA_RULES.oscillator) },
    { id: 'stoch', value: st, reading: band(st, TA_RULES.oscillator) },
    { id: 'stochrsi', value: srsi, reading: band(srsi, TA_RULES.oscillator) },
    { id: 'macd', value: m, reading: band(m, TA_RULES.zero) },
    { id: 'adx', value: ax, reading: adxReading },
    { id: 'williams', value: w, reading: band(w, TA_RULES.williams) },
    { id: 'cci', value: cc, reading: band(cc, TA_RULES.cci) },
    { id: 'atr', value: at, reading: null },
    { id: 'highslows', value: hl, reading: band(hl, TA_RULES.zero) },
    { id: 'uo', value: uo, reading: band(uo, TA_RULES.oscillator) },
    { id: 'roc', value: rc, reading: band(rc, TA_RULES.zero) },
    { id: 'bbp', value: bbp, reading: band(bbp, TA_RULES.zero) },
  ];
  const maReadings = movingAverages.flatMap((x) => [x.simpleReading, x.exponentialReading]);
  const indReadings = indicators.map((x) => x.reading);
  const lastDaily = daily.at(-1);
  const V = FORMULA_VERSIONS;
  return {
    formulaVersion: TECHNICAL_VERSION,
    indicatorVersions: [
      V.sma,
      V.ema,
      V.rsi,
      V.stochastic,
      V.stochRsi,
      V.macd,
      V.adx,
      V.williamsR,
      V.cci,
      V.atr,
      V.highsLows,
      V.ultimate,
      V.roc,
      V.bullBearPower,
    ].join(', '),
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
