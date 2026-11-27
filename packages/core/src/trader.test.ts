import { describe, expect, it } from 'vitest';
import type { DailyBar } from './study.js';
import { TRADER_VERSION, daysBetween, traderMetrics } from './trader.js';

const day = (i: number) =>
  new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
const bar = (i: number, close: number, high = close + 1, low = close - 1): DailyBar => ({
  date: day(i),
  open: close,
  high,
  low,
  close,
  volume: 1,
  vwap: null,
});

describe('traderMetrics, hand-checked (trader-1)', () => {
  // 60 flat sessions at 100 with a 99 to 101 range (true range 2, so ATR 2), then one close at 104 (high 105,
  // low 103): true range max(2, |105 - 100|, |103 - 100|) = 5, Wilder ATR = 2 + (5 - 2) / 14 = 31 / 14.
  const bars = [...Array.from({ length: 60 }, (_, i) => bar(i, 100)), bar(60, 104)];
  const m = traderMetrics(bars, bars);

  it('ATR 14 and ATR as a share of the close', () => {
    expect(m?.atr14).toBeCloseTo(31 / 14, 12);
    expect(m?.atrPct).toBeCloseTo(31 / 14 / 104, 12); // 0.021291...
  });

  it('stretch from the 20- and 50-day averages, in ATRs', () => {
    // SMA 20 = (19 x 100 + 104) / 20 = 100.2; SMA 50 = (49 x 100 + 104) / 50 = 100.08.
    expect(m?.stretch20).toBeCloseTo((104 - 100.2) / (31 / 14), 12); // 1.716129...
    expect(m?.stretch50).toBeCloseTo((104 - 100.08) / (31 / 14), 12); // 1.770323...
  });

  it('needs 252 sessions for the distance from the high', () => {
    expect(m?.fromHigh).toBeNull();
    const year = Array.from({ length: 252 }, (_, i) => bar(i, i === 100 ? 120 : 100));
    expect(traderMetrics(year, year)?.fromHigh).toBeCloseTo(100 / 120 - 1, 12); // -16.67%
  });

  it('relative strength over 63 sessions against SPY and the sector fund', () => {
    // The stock rises 10% over the window, SPY 5%, the sector fund 10%: 1.10 / 1.05 - 1 and 0.
    const n = 64;
    const path = (end: number) =>
      Array.from({ length: n }, (_, i) => bar(i, 100 + (end - 100) * (i / (n - 1))));
    const r = traderMetrics(path(110), path(105), path(110));
    expect(r?.rsSpy).toBeCloseTo(1.1 / 1.05 - 1, 12); // 0.047619...
    expect(r?.rsSector).toBeCloseTo(0, 12);
    expect(traderMetrics(path(110).slice(0, 63), path(105))?.rsSpy).toBeNull();
  });

  it('says nothing without bars and stamps its version', () => {
    expect(traderMetrics([], [])).toBeNull();
    expect(m?.formulaVersion).toBe(TRADER_VERSION);
    expect(m?.rsSector).toBeNull();
  });
});

describe('daysBetween', () => {
  it('counts calendar days, across a month end and backwards', () => {
    expect(daysBetween('2026-11-27', '2026-12-04')).toBe(7);
    expect(daysBetween('2026-11-27', '2026-11-20')).toBe(-7);
    expect(daysBetween('2026-11-27', '2026-11-27')).toBe(0);
  });
});
