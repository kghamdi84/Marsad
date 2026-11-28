import { describe, expect, it } from 'vitest';
import { LEVELS_VERSION, priceLevels } from './levels.js';
import type { DailyBar } from './study.js';

const date = (i: number) =>
  new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
/** n flat bars (high 101, low 99, close 100) with the given lows and highs swapped in. */
function bars(lows: Record<number, number>, highs: Record<number, number>, n = 61): DailyBar[] {
  return Array.from({ length: n }, (_, i) => ({
    date: date(i),
    open: 100,
    high: highs[i] ?? 101,
    low: lows[i] ?? 99,
    close: 100,
    volume: 1,
    vwap: null,
  }));
}

describe('levels-1', () => {
  it('clusters swing lows and highs within 1.5% and keeps those touched twice', () => {
    // Lows 90 and 90.9 (1% apart) make support at 90.45; highs 110 and 110.5 make resistance at 110.25. The lone
    // low of 80 has one touch and is dropped.
    const r = priceLevels(bars({ 10: 90, 30: 90.9, 50: 80 }, { 20: 110, 40: 110.5 }));
    expect(r.formulaVersion).toBe(LEVELS_VERSION);
    expect(r.close).toBe(100);
    expect(r.asOf).toBe(date(60));
    expect(r.levels).toHaveLength(2);
    const [res, sup] = r.levels;
    expect(res).toMatchObject({ kind: 'resistance', touches: 2, from: date(20), to: date(40) });
    expect(res?.price).toBeCloseTo(110.25, 10);
    expect(res?.distancePct).toBeCloseTo(10.25, 10);
    expect(sup).toMatchObject({ kind: 'support', touches: 2, from: date(10), to: date(30) });
    expect(sup?.price).toBeCloseTo(90.45, 10);
    expect(sup?.distancePct).toBeCloseTo(-9.55, 10);
  });

  it('does not group pivots more than 1.5% apart, and needs 5 bars on each side', () => {
    // 90 and 92 are 2.2% apart: two single touches, no level. A dip 3 bars from the end is not a pivot.
    expect(priceLevels(bars({ 10: 90, 30: 92, 57: 90 }, {})).levels).toEqual([]);
  });

  it('keeps at most 4 a side, nearest to the close first', () => {
    const lows: Record<number, number> = {};
    // Five support pairs at 95, 93, 91, 89, 87, every low 6 bars from the next, so each is a pivot.
    [95, 93, 91, 89, 87].forEach((p, k) => {
      lows[6 + k * 12] = p;
      lows[12 + k * 12] = p;
    });
    const r = priceLevels(bars(lows, {}, 70));
    expect(r.levels.map((l) => Math.round(l.price))).toEqual([95, 93, 91, 89]);
    expect(priceLevels([]).levels).toEqual([]);
  });
});
