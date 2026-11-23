import { describe, expect, it } from 'vitest';
import golden from '../../../fixtures/indicators/golden.json';
import spy from '../../../fixtures/massive/aggs-SPY-1d-2026-10.json';
import { atr, ema, macd, rsi, rvol, sma, trueRange, vwap, type Series } from './indicators.js';

const { o: _open, h, l, c, v } = golden.input;
void _open;
type Golden = (number | null)[];

/** Compares to the reference within an absolute-or-relative tolerance, including the null warm-up. */
function expectClose(actual: Series, expected: Golden, tol = 1e-9): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((e, i) => {
    const a = actual[i];
    if (e === null) {
      expect(a, `index ${i} should be null`).toBeNull();
    } else {
      expect(a, `index ${i} should be a number`).not.toBeNull();
      expect(Math.abs((a as number) - e)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(e)));
    }
  });
}

describe('golden values from pandas (120 seeded bars, tolerance 1e-9)', () => {
  it('sma(20)', () => expectClose(sma(c, 20), golden.sma20));
  it('ema(12) and ema(26)', () => {
    expectClose(ema(c, 12), golden.ema12);
    expectClose(ema(c, 26), golden.ema26);
  });
  it('rsi(14)', () => expectClose(rsi(c, 14), golden.rsi14));
  it('true range and atr(14)', () => {
    expectClose(trueRange(h, l, c), golden.trueRange);
    expectClose(atr(h, l, c, 14), golden.atr14);
  });
  it('macd(12, 26, 9) line, signal and histogram', () => {
    const m = macd(c);
    expectClose(m.line, golden.macd.line);
    expectClose(m.signal, golden.macd.signal);
    expectClose(m.histogram, golden.macd.histogram);
  });
  it('vwap', () => expectClose(vwap(h, l, c, v), golden.vwap));
  it('rvol(20)', () => expectClose(rvol(v, 20), golden.rvol20));
});

describe('hand-checked small cases', () => {
  it('sma of 1..5 with period 3', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });
  it('ema(3) of 1..5: seed 2 at index 2, alpha 0.5', () => {
    // seed = (1+2+3)/3 = 2; next = 0.5*4 + 0.5*2 = 3; then 0.5*5 + 0.5*3 = 4
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });
  it('ema of a constant series is the constant', () => {
    expect(ema([7, 7, 7, 7, 7, 7], 4)).toEqual([null, null, null, 7, 7, 7]);
  });
  it('vwap of two bars', () => {
    // typical prices 10 and 20; volumes 100 and 300: (1000 + 6000) / 400 = 17.5
    expect(vwap([10, 20], [10, 20], [10, 20], [100, 300])).toEqual([10, 17.5]);
  });
  it('rvol of a doubled volume', () => {
    expect(rvol([100, 100, 100, 200], 3)).toEqual([null, null, null, 2]);
  });
  it('true range uses the previous close on a gap', () => {
    // bar 2 gaps up: low 15 is above previous close 10, so TR = high - previous close = 20 - 10
    expect(trueRange([12, 20], [8, 15], [10, 18])).toEqual([4, 10]);
  });
});

describe('RSI hand check', () => {
  // 33 closes of a classic worked example. The first RSI(14) is derivable by hand: over the first
  // 14 changes the gains sum to 3.34 and the losses to 1.40, so RSI = 100 * 3.34 / (3.34 + 1.40).
  const closes = [
    44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28,
    46.28, 46.0, 46.03, 46.41, 46.22, 45.64, 46.21, 46.25, 45.71, 46.45, 45.78, 45.35, 44.03, 44.18,
    44.22, 44.57, 43.42, 42.66, 43.13,
  ];
  // Rounded to 2 decimals, from an independent plain-Python Wilder loop (not pandas).
  const expected = [
    70.46, 66.25, 66.48, 69.35, 66.29, 57.92, 62.88, 63.21, 56.01, 62.34, 54.67, 50.39, 40.02,
    41.49, 41.9, 45.5, 37.32, 33.09, 37.79,
  ];
  it('first value equals the hand calculation', () => {
    expect(rsi(closes, 14)[14]).toBeCloseTo((100 * 3.34) / (3.34 + 1.4), 10);
  });
  it('matches the independent loop to 2 decimals', () => {
    const out = rsi(closes, 14).slice(14) as number[];
    expect(out).toHaveLength(expected.length);
    out.forEach((x, i) => expect(Math.abs(x - (expected[i] as number))).toBeLessThanOrEqual(0.005));
  });
  it('is null during warm-up', () => {
    expect(
      rsi(closes, 14)
        .slice(0, 14)
        .every((x) => x === null),
    ).toBe(true);
  });
});

describe('RSI edge cases', () => {
  it('is 100 for a strictly rising series and 50 for a flat one', () => {
    expect(rsi([1, 2, 3, 4, 5, 6], 3).slice(3)).toEqual([100, 100, 100]);
    expect(rsi([5, 5, 5, 5, 5, 5], 3).slice(3)).toEqual([50, 50, 50]);
  });
  it('stays within 0 to 100 on the SPY fixture', () => {
    const closes = spy.results.map((b) => b.c);
    for (const x of rsi(closes, 5)) {
      if (x !== null) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe('real SPY bars (recorded October 2026)', () => {
  const closes = spy.results.map((b) => b.c);
  it('sma(5) of the last five closes equals their mean', () => {
    const last5 = closes.slice(-5);
    const expected = last5.reduce((a, b) => a + b, 0) / 5;
    expect(sma(closes, 5).at(-1)).toBeCloseTo(expected, 10);
  });
  it('the vendor vw field is close to our typical-price vwap for a single daily bar', () => {
    // Cross-source sanity: Massive's daily vw versus (h+l+c)/3. They measure different things,
    // so the allowed difference is generous (0.5%); the real cross-check runs on minute bars in Phase 1.10.
    spy.results.forEach((b) => {
      const typical = (b.h + b.l + b.c) / 3;
      expect(Math.abs(b.vw - typical) / typical).toBeLessThan(0.005);
    });
  });
});

describe('input validation', () => {
  it('rejects bad periods and mismatched lengths', () => {
    expect(() => sma([1, 2], 0)).toThrow(RangeError);
    expect(() => ema([1, 2], 1.5)).toThrow(RangeError);
    expect(() => macd([1, 2, 3], 26, 12)).toThrow(RangeError);
    expect(() => trueRange([1], [1, 2], [1])).toThrow(RangeError);
  });
  it('returns all nulls when there is too little data', () => {
    expect(sma([1, 2], 5)).toEqual([null, null]);
    expect(ema([1, 2], 5)).toEqual([null, null]);
    expect(rsi([1, 2], 14)).toEqual([null, null]);
    expect(atr([1, 2], [1, 2], [1, 2], 14)).toEqual([null, null]);
  });
});
