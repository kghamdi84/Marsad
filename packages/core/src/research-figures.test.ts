import { describe, expect, it } from 'vitest';
import {
  RESEARCH_TOLERANCES,
  dailyBeta,
  differsBeyond,
  epsYearOnYear,
  impliedMove,
  relativePerformance,
  sessionReturn,
  trailingDividendYield,
} from './research-figures.js';
import type { DailyBar } from './study.js';

const bar = (date: string, close: number): DailyBar => ({
  date,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
  vwap: null,
});
/** Bars on consecutive days from 2025-01-01 with the given closes. */
const run = (closes: readonly number[], start = Date.UTC(2025, 0, 1)) =>
  closes.map((c, i) => bar(new Date(start + i * 86_400_000).toISOString().slice(0, 10), c));

describe('impliedMove', () => {
  it('is the signed percent from the close to the target', () => {
    // NVDA on 2026-11-28: mean target 242.4278 against a 200.00 close is +21.2139%.
    expect(impliedMove(242.4278, 200)).toBeCloseTo(21.2139, 4);
    expect(impliedMove(130, 200)).toBe(-35);
    expect(impliedMove(200, 200)).toBe(0);
  });
  it('is null without a positive close or a finite target', () => {
    expect(impliedMove(null, 200)).toBeNull();
    expect(impliedMove(240, 0)).toBeNull();
    expect(impliedMove(Number.NaN, 200)).toBeNull();
    expect(impliedMove(240, undefined)).toBeNull();
    expect(impliedMove(-1, 200)).toBeNull();
  });
});

describe('relativePerformance', () => {
  // 64 bars: the stock goes 100 to 110 (+10%), SPY 400 to 420 (+5%).
  const closes = Array.from({ length: 64 }, (_, i) => 100 + (10 * i) / 63);
  const spyCloses = Array.from({ length: 64 }, (_, i) => 400 + (20 * i) / 63);
  const stock = run(closes);
  const spy = run(spyCloses);

  it('measures both from the same start close, 63 sessions back for 3M', () => {
    const r = relativePerformance(stock, spy, '3m');
    if (!r.available) throw new Error('expected available');
    expect(r.start).toBe(stock[0]?.date);
    expect(r.end).toBe(stock.at(-1)?.date);
    expect(r.points).toHaveLength(64);
    expect(r.points[0]).toEqual({ date: stock[0]?.date, stock: 0, spy: 0 });
    expect(r.stockPct).toBeCloseTo(10, 10);
    expect(r.spyPct).toBeCloseTo(5, 10);
  });

  it('is unavailable with the sessions needed when history is short', () => {
    expect(relativePerformance(stock.slice(1), spy, '3m')).toEqual({
      available: false,
      range: '3m',
      reason: 'short-history',
      needs: 64,
      have: 63,
    });
    expect(relativePerformance(stock, spy, '5y')).toMatchObject({ available: false, needs: 1261 });
    expect(relativePerformance([], spy, '1y')).toMatchObject({
      available: false,
      reason: 'no-bars',
    });
  });

  it('starts YTD from the last close of the previous year', () => {
    const s = [
      bar('2025-12-30', 90),
      bar('2025-12-31', 100),
      bar('2026-01-02', 105),
      bar('2026-01-05', 120),
    ];
    const p = [bar('2025-12-31', 500), bar('2026-01-05', 490)];
    const r = relativePerformance(s, p, 'ytd');
    if (!r.available) throw new Error('expected available');
    expect(r.start).toBe('2025-12-31');
    expect(r.stockPct).toBeCloseTo(20, 10);
    expect(r.spyPct).toBeCloseTo(-2, 10);
    // SPY has no bar on 2 January: that point has no SPY value rather than a carried one.
    expect(r.points.map((x) => x.spy)).toEqual([0, null, expect.closeTo(-2, 10)]);
    // A first year with no earlier close cannot show YTD.
    expect(relativePerformance(s.slice(2), p, 'ytd')).toMatchObject({
      available: false,
      reason: 'short-history',
    });
  });

  it('gives no SPY figure when SPY has no bar on the start date', () => {
    const r = relativePerformance(stock, spy.slice(1), '3m');
    if (!r.available) throw new Error('expected available');
    expect(r.spyPct).toBeNull();
    expect(r.points.every((x) => x.spy === null)).toBe(true);
  });
});

describe('dailyBeta', () => {
  // SPY alternates +1% and -0.5%; the stock moves exactly twice as much each day, so beta is 2.
  const n = 260;
  const spyC = [100];
  const stC = [50];
  for (let i = 1; i < n; i += 1) {
    const r = i % 2 ? 0.01 : -0.005;
    spyC.push((spyC[i - 1] as number) * (1 + r));
    stC.push((stC[i - 1] as number) * (1 + 2 * r));
  }
  it('is the slope of the stock returns on SPY returns over the newest 252', () => {
    const b = dailyBeta(run(stC), run(spyC));
    expect(b?.value).toBeCloseTo(2, 10);
    expect(b?.returns).toBe(252);
  });
  it('is null with fewer than 200 matched returns', () => {
    expect(dailyBeta(run(stC.slice(0, 200)), run(spyC.slice(0, 200)))).toBeNull();
    expect(dailyBeta(run(stC.slice(0, 201)), run(spyC.slice(0, 201)))?.returns).toBe(200);
  });
});

describe('trailingDividendYield', () => {
  const d = (date: string, amt: number, currency = 'USD') => ({
    exDividendDate: date,
    cashAmount: amt,
    currency,
  });
  it('adds the cash paid with ex-dates in the 365 days to the date, over the close', () => {
    const rows = [
      d('2025-11-27', 0.25), // 366 days before: outside
      d('2025-11-28', 0.25),
      d('2026-03-01', 0.25),
      d('2026-06-01', 0.25),
      d('2026-09-01', 0.25),
      d('2026-12-01', 0.25), // after the date: outside
    ];
    const r = trailingDividendYield(rows, 100, '2026-11-27');
    expect(r).toEqual({ pct: 1, total: 1, count: 4, from: '2025-11-28' });
  });
  it('is 0 with no dividends, and null for a foreign currency or no close', () => {
    expect(trailingDividendYield([], 50, '2026-11-27')?.pct).toBe(0);
    expect(trailingDividendYield([d('2026-06-01', 1, 'EUR')], 50, '2026-11-27')).toBeNull();
    expect(trailingDividendYield([], 0, '2026-11-27')).toBeNull();
  });
});

describe('differsBeyond', () => {
  it('compares relative to Marsad and absolute in units', () => {
    expect(differsBeyond(100, 104, RESEARCH_TOLERANCES.marketValue)).toEqual({
      differs: false,
      diff: 4,
    });
    expect(differsBeyond(100, 106, RESEARCH_TOLERANCES.marketValue)?.differs).toBe(true);
    expect(differsBeyond(2.0, 2.25, RESEARCH_TOLERANCES.beta)?.differs).toBe(false);
    expect(differsBeyond(1.6, 2.25, RESEARCH_TOLERANCES.beta)?.differs).toBe(true);
    expect(differsBeyond(0.5, 0.67, RESEARCH_TOLERANCES.dividendYield)?.differs).toBe(true);
    expect(differsBeyond(null, 1, RESEARCH_TOLERANCES.beta)).toBeNull();
  });
});

describe('epsYearOnYear', () => {
  const q = (end: string, value: number | null) => ({ end, value, derived: false, filed: null });
  it('sets each quarter beside the same quarter a year earlier', () => {
    const rows = epsYearOnYear([
      q('2025-03-31', 1.0),
      q('2025-06-30', -0.5),
      q('2026-03-31', 1.25),
      q('2026-06-29', 0.25),
    ]);
    // 1.25 against 1.00: +$0.25, +25%.
    expect(rows[2]?.prior?.end).toBe('2025-03-31');
    expect(rows[2]?.changeUsd).toBeCloseTo(0.25, 12);
    expect(rows[2]?.changePct).toBeCloseTo(25, 10);
    // From a loss of 0.50 to 0.25: +$0.75 and no percentage.
    expect(rows[3]?.changeUsd).toBeCloseTo(0.75, 12);
    expect(rows[3]?.changePct).toBeNull();
    expect(rows[0]?.prior).toBeNull();
    expect(rows[0]?.changeUsd).toBeNull();
  });
});

describe('sessionReturn', () => {
  it('is the percent change over the last n sessions', () => {
    expect(sessionReturn(run([100, 105, 110]), 2)).toBeCloseTo(10, 12);
    expect(sessionReturn(run([100, 105]), 2)).toBeNull();
  });
});
