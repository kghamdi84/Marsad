import { describe, expect, it } from 'vitest';
import { rsi } from './indicators.js';
import type { DailyBar } from './study.js';
import {
  TECHNICAL_ANALYSIS_VERSION,
  adx,
  bollinger,
  bullBearPower,
  cci,
  highsLows,
  pivotPoints,
  resampleBars,
  roc,
  stochRsi,
  stochastic,
  technicalAnalysis,
  ultimateOscillator,
  williamsR,
} from './technical-analysis.js';

const b = (date: string, o: number, h: number, l: number, c: number, v = 10): DailyBar => ({
  date,
  open: o,
  high: h,
  low: l,
  close: c,
  volume: v,
  vwap: null,
});
/** n bars on consecutive days; close rises 1 a day from 100, high 1 above, low 1 below. */
const rising = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    b(
      new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
      100 + i,
      101 + i,
      99 + i,
      100 + i,
    ),
  );

describe('pivot points', () => {
  it('classic and Fibonacci from high 110, low 90, close 100', () => {
    const p = pivotPoints(110, 90, 100);
    expect(p.classic).toEqual({ s3: 70, s2: 80, s1: 90, p: 100, r1: 110, r2: 120, r3: 130 });
    expect(p.fibonacci.p).toBe(100);
    expect(p.fibonacci.r1).toBeCloseTo(107.64, 10);
    expect(p.fibonacci.r2).toBeCloseTo(112.36, 10);
    expect(p.fibonacci.r3).toBe(120);
    expect(p.fibonacci.s1).toBeCloseTo(92.36, 10);
    expect(p.fibonacci.s2).toBeCloseTo(87.64, 10);
    expect(p.fibonacci.s3).toBe(80);
  });
});

describe('bollinger', () => {
  it('closes 1 to 20: middle 10.5, bands 2 population deviations (sqrt(399 / 12)) away', () => {
    const c = Array.from({ length: 20 }, (_, i) => i + 1);
    const bb = bollinger(c, 20, 2);
    const sd = Math.sqrt(399 / 12);
    expect(bb.middle.at(-1)).toBe(10.5);
    expect(bb.upper.at(-1)).toBeCloseTo(10.5 + 2 * sd, 10);
    expect(bb.lower.at(-1)).toBeCloseTo(10.5 - 2 * sd, 10);
    expect(bb.upper[18]).toBeNull();
    expect(bollinger(Array<number>(25).fill(7)).upper.at(-1)).toBe(7);
  });
});

describe('resampleBars', () => {
  const days = [
    b('2026-11-23', 10, 12, 9, 11, 1), // Monday
    b('2026-11-24', 11, 15, 10, 14, 2),
    b('2026-11-27', 14, 14, 8, 9, 3), // Friday
    b('2026-11-30', 9, 10, 7, 8, 4), // next Monday
    b('2026-12-01', 8, 20, 8, 19, 5),
  ];
  it('builds Monday to Friday weeks dated by their last session', () => {
    expect(resampleBars(days, 'weekly')).toEqual([
      b('2026-11-27', 10, 15, 8, 9, 6),
      b('2026-12-01', 9, 20, 7, 19, 9),
    ]);
  });
  it('builds calendar months', () => {
    expect(resampleBars(days, 'monthly')).toEqual([
      b('2026-11-30', 10, 15, 7, 8, 10),
      b('2026-12-01', 8, 20, 8, 19, 5),
    ]);
  });
});

describe('oscillators by hand', () => {
  it('ADX is 100 with +DI 50 and -DI 0 on a steady rise of equal ranges', () => {
    // Each bar: +DM 1, -DM 0, true range 2, so +DI = 100 x 1 / 2 = 50, -DI 0, DX 100.
    const r = rising(40);
    const a = adx(
      r.map((x) => x.high),
      r.map((x) => x.low),
      r.map((x) => x.close),
      14,
    );
    expect(a?.adx).toBeCloseTo(100, 10);
    expect(a?.plusDi).toBeCloseTo(50, 10);
    expect(a?.minusDi).toBe(0);
    expect(adx([1], [1], [1], 14)).toBeNull();
  });
  it('Williams %R and Highs/Lows: 14-bar high 120, low 100, close 115', () => {
    const h = [...Array<number>(13).fill(110), 120];
    const l = [100, ...Array<number>(13).fill(105)];
    const c = [...Array<number>(13).fill(108), 115];
    expect(williamsR(h, l, c, 14)).toBeCloseTo(-25, 10);
    expect(highsLows(h, l, c, 14)).toBeCloseTo(5, 10);
  });
  it('CCI: typical prices 1, 2, 3 give (3 - 2) / (0.015 x 2/3) = 100', () => {
    expect(cci([1, 2, 3], [1, 2, 3], [1, 2, 3], 3)).toBeCloseTo(100, 10);
    expect(cci([1, 1, 1], [1, 1, 1], [1, 1, 1], 3)).toBeNull();
  });
  it('ROC: 100 to 110 over 12 bars is +10%', () => {
    expect(roc([100, ...Array<number>(11).fill(105), 110], 12)).toBeCloseTo(10, 10);
    expect(roc([1, 2], 12)).toBeNull();
  });
  it('Stochastic: closes 1, 2, 3, 2 with k 3 and smoothing 2 give (100 + 0) / 2', () => {
    const c = [1, 2, 3, 2];
    expect(stochastic(c, c, c, 3, 2)).toBeCloseTo(50, 10);
  });
  it('Ultimate Oscillator is 50 when every bar buys half its true range', () => {
    // Each bar: previous close = today's low, so buying pressure 1 and true range 2.
    const r = rising(40);
    expect(
      ultimateOscillator(
        r.map((x) => x.high),
        r.map((x) => x.low),
        r.map((x) => x.close),
      ),
    ).toBeCloseTo(50, 10);
  });
  it('Bull/Bear Power is 0 on a flat series with a symmetric range', () => {
    const n = 20;
    expect(
      bullBearPower(
        Array<number>(n).fill(101),
        Array<number>(n).fill(99),
        Array<number>(n).fill(100),
        13,
      ),
    ).toBe(0);
  });
  it('StochRSI places the last RSI in its 14-bar range, and is null when RSI is flat', () => {
    const c = Array.from({ length: 60 }, (_, i) => 100 + 10 * Math.sin(i / 3));
    const r = rsi(c, 14).slice(-14) as number[];
    const want =
      (((r.at(-1) as number) - Math.min(...r)) / (Math.max(...r) - Math.min(...r))) * 100;
    expect(stochRsi(c, 14)).toBeCloseTo(want, 10);
    expect(
      stochRsi(
        rising(40).map((x) => x.close),
        14,
      ),
    ).toBeNull();
  });
});

describe('technicalAnalysis', () => {
  it('reads a steady rise as bullish on every counted moving average and gauge', () => {
    const t = technicalAnalysis(rising(260), 'daily');
    expect(t.formulaVersion).toBe(TECHNICAL_ANALYSIS_VERSION);
    expect(t.bars).toBe(260);
    expect(t.close).toBe(359);
    // SMA 5 of 355..359 = 357.
    expect(t.movingAverages[0]).toMatchObject({ period: 5, simple: 357, simpleReading: 'bullish' });
    expect(t.gauges.movingAverages).toEqual({
      bullish: 12,
      neutral: 0,
      bearish: 0,
      reading: 'bullish',
    });
    const ind = new Map(t.indicators.map((x) => [x.id, x]));
    expect(ind.get('rsi14')).toMatchObject({ value: 100, reading: 'bullish' });
    expect(ind.get('adx')?.reading).toBe('bullish');
    expect(ind.get('atr')).toMatchObject({ value: 2, reading: null });
    expect(ind.get('roc')?.reading).toBe('bullish');
    expect(t.gauges.overall.reading).toBe('bullish');
    expect(t.pivots?.date).toBe('2025-09-17');
    expect(t.pivots?.classic.p).toBeCloseTo(359, 10);
  });
  it('leaves readings that need more bars not available and uncounted', () => {
    const t = technicalAnalysis(rising(260), 'monthly');
    // 260 days from 1 January 2025 span 9 months: SMA 10 and longer are not available.
    expect(t.bars).toBe(9);
    expect(t.movingAverages.find((x) => x.period === 10)?.simple).toBeNull();
    expect(t.movingAverages.find((x) => x.period === 5)?.simpleReading).toBe('bullish');
    expect(t.gauges.movingAverages.bullish).toBe(2);
    expect(technicalAnalysis([], 'daily').gauges.overall.reading).toBeNull();
  });
});
