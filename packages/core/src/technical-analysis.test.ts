import { describe, expect, it } from 'vitest';
import type { DailyBar } from './study.js';
import {
  TA_RULES,
  TECHNICAL_VERSION,
  gauge,
  pivotPoints,
  resampleBars,
  technicalAnalysis,
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

describe('technicalAnalysis', () => {
  it('reads a steady rise as bullish on every counted moving average and gauge', () => {
    const t = technicalAnalysis(rising(260), 'daily');
    expect(t.formulaVersion).toBe(TECHNICAL_VERSION);
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

describe('gauge and the single rule set', () => {
  it('reads bullish or bearish only on more than half the counted readings', () => {
    expect(gauge(['bullish', 'bullish', 'neutral'])).toEqual({
      bullish: 2,
      neutral: 1,
      bearish: 0,
      reading: 'bullish',
    });
    expect(gauge(['bullish', 'bearish', 'neutral', null])).toMatchObject({ reading: 'neutral' });
    expect(gauge(['bearish', 'bearish', 'bullish'])).toMatchObject({ reading: 'bearish' });
    expect(gauge([null])).toMatchObject({ reading: null });
    expect(TA_RULES.oscillator).toEqual([45, 55]);
  });
  it('rejects bars out of order', () => {
    const r = rising(3);
    expect(() => technicalAnalysis([r[1] as DailyBar, r[0] as DailyBar], 'daily')).toThrow(
      RangeError,
    );
  });
});
