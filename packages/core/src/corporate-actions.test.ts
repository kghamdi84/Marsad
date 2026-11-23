import { describe, expect, it } from 'vitest';
import splitsFixture from '../../../fixtures/massive/splits-NVDA.json';
import {
  adjustBars,
  checkBigMove,
  cumulativeFactor,
  fractionalMove,
  instrumentKey,
  isFigi,
  normalizeCik,
  splitFactor,
  type Bar,
  type Split,
} from './corporate-actions.js';

const nvda: Split[] = splitsFixture.data.map((s) => ({
  ticker: s.ticker,
  executionDate: s.execution_date,
  splitFrom: s.split_from,
  splitTo: s.split_to,
  adjustmentType: s.adjustment_type,
}));

describe('against the recorded NVDA splits', () => {
  it('our cumulative factor equals the vendor historical_adjustment_factor on each split date', () => {
    // The vendor factor on a split's own row covers that split and every later one.
    for (const row of splitsFixture.data) {
      // The day before the split executes, every split on or after execution_date still applies.
      const dayBefore = new Date(Date.parse(`${row.execution_date}T00:00:00Z`) - 86_400_000)
        .toISOString()
        .slice(0, 10);
      expect(cumulativeFactor(dayBefore, nvda)).toBeCloseTo(row.historical_adjustment_factor, 5);
    }
  });
  it('is 1 for dates after the last split', () => {
    expect(cumulativeFactor('2025-01-02', nvda)).toBe(1);
  });
});

describe('splitFactor', () => {
  it('forward, reverse and fractional splits', () => {
    expect(
      splitFactor({
        ticker: 'X',
        executionDate: '2024-01-01',
        splitFrom: 1,
        splitTo: 10,
        adjustmentType: 'forward_split',
      }),
    ).toBe(0.1);
    expect(
      splitFactor({
        ticker: 'X',
        executionDate: '2024-01-01',
        splitFrom: 10,
        splitTo: 1,
        adjustmentType: 'reverse_split',
      }),
    ).toBe(10);
    expect(
      splitFactor({
        ticker: 'X',
        executionDate: '2024-01-01',
        splitFrom: 2,
        splitTo: 3,
        adjustmentType: 'forward_split',
      }),
    ).toBeCloseTo(2 / 3, 12);
  });
  it('rejects a non-positive ratio', () => {
    expect(() =>
      splitFactor({
        ticker: 'X',
        executionDate: '2024-01-01',
        splitFrom: 0,
        splitTo: 1,
        adjustmentType: 'x',
      }),
    ).toThrow(RangeError);
  });
});

describe('adjustBars', () => {
  // Daily bars at 04:00Z (midnight ET in summer). 2024-06-07 is before the 10:1 split on 2024-06-10.
  const day = (iso: string): number => Date.parse(`${iso}T04:00:00Z`);
  const bars: Bar[] = [
    { t: day('2024-06-07'), o: 1200, h: 1230, l: 1190, c: 1210, v: 1000 },
    { t: day('2024-06-10'), o: 121, h: 123, l: 119, c: 121, v: 10000 },
  ];
  it('scales prices down and volume up before the split, and leaves later bars alone', () => {
    const [pre, post] = adjustBars(bars, nvda);
    expect(pre?.c).toBeCloseTo(121, 9);
    expect(pre?.v).toBeCloseTo(10000, 6);
    expect(post).toEqual(bars[1]);
  });
  it('makes the series continuous across the split', () => {
    const [pre, post] = adjustBars(bars, nvda);
    expect(Math.abs(fractionalMove((pre as Bar).c, (post as Bar).c))).toBeLessThan(0.01);
  });
});

describe('checkBigMove', () => {
  const split: Split = {
    ticker: 'XYZ',
    executionDate: '2026-11-24',
    splitFrom: 1,
    splitTo: 4,
    adjustmentType: 'forward_split',
  };
  it('ignores moves under 25%', () => {
    expect(checkBigMove(100, 110, '2026-11-24', [split])).toEqual({
      big: false,
      explainedBy: null,
    });
  });
  it('explains a 4:1 split drop as a split, not a crash', () => {
    const r = checkBigMove(400, 101, '2026-11-24', [split]);
    expect(r.big).toBe(true);
    expect(r.explainedBy).toBe(split);
  });
  it('leaves a real 27% gap unexplained, even if a split exists on another day', () => {
    const r = checkBigMove(100, 127, '2026-11-25', [split]);
    expect(r.big).toBe(true);
    expect(r.explainedBy).toBeNull();
  });
  it('does not accept a split whose ratio does not match the move', () => {
    expect(checkBigMove(100, 60, '2026-11-24', [split]).explainedBy).toBeNull();
  });
});

describe('identity', () => {
  it('normalises CIKs to 10 digits', () => {
    expect(normalizeCik(1045810)).toBe('0001045810');
    expect(normalizeCik('0001045810')).toBe('0001045810');
    expect(() => normalizeCik('abc')).toThrow(RangeError);
    expect(() => normalizeCik('12345678901')).toThrow(RangeError);
  });
  it('recognises composite FIGIs', () => {
    expect(isFigi('BBG000BBJQV0')).toBe(true);
    expect(isFigi('BBG000BBJQV')).toBe(false);
    expect(isFigi('XYZ000BBJQV0')).toBe(false);
  });
  it('keys by FIGI first, so a ticker change keeps the same key', () => {
    const before = instrumentKey({ cik: '0001045810', figi: 'BBG000BBJQV0', ticker: 'OLD' });
    const after = instrumentKey({ cik: '0001045810', figi: 'BBG000BBJQV0', ticker: 'NEW' });
    expect(before).toBe(after);
    expect(instrumentKey({ cik: '0001045810', figi: null, ticker: 'NVDA' })).toBe(
      'cik:0001045810:NVDA',
    );
    expect(instrumentKey({ cik: null, figi: null, ticker: 'SPY' })).toBe('ticker:SPY');
  });
});
