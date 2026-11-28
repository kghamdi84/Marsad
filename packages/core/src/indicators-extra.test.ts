import { describe, expect, it } from 'vitest';
import {
  adx,
  bollinger,
  bullBearPower,
  cci,
  highsLows,
  roc,
  rsi,
  stochRsi,
  stochastic,
  ultimateOscillator,
  williamsR,
} from './indicators.js';

/** n bars; close rises 1 a bar from 100, high 1 above, low 1 below. */
const rising = (n: number) => {
  const c = Array.from({ length: n }, (_, i) => 100 + i);
  return { h: c.map((v) => v + 1), l: c.map((v) => v - 1), c };
};

// Hand-checked known answers (tolerance 1e-10) and warm-up lengths for the technical-1 indicators.
describe('bollinger (bollinger-population@1)', () => {
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

describe('adx (adx-wilder@1)', () => {
  it('is 100 with +DI 50 and -DI 0 on a steady rise of equal ranges', () => {
    // Each bar: +DM 1, -DM 0, true range 2, so +DI = 100 x 1 / 2 = 50, -DI 0, DX 100.
    const r = rising(40);
    const a = adx(r.h, r.l, r.c, 14);
    expect(a.adx.at(-1)).toBeCloseTo(100, 10);
    expect(a.plusDi.at(-1)).toBeCloseTo(50, 10);
    expect(a.minusDi.at(-1)).toBe(0);
    // DI from index 14, ADX from index 27.
    expect(a.plusDi[13]).toBeNull();
    expect(a.plusDi[14]).not.toBeNull();
    expect(a.adx[26]).toBeNull();
    expect(a.adx[27]).toBeCloseTo(100, 10);
  });
});

describe('williamsR (williams-r@1) and highsLows (highs-lows-midpoint@1)', () => {
  it('14-bar high 120, low 100, close 115: %R -25, 5 above the midpoint 110', () => {
    const h = [...Array<number>(13).fill(110), 120];
    const l = [100, ...Array<number>(13).fill(105)];
    const c = [...Array<number>(13).fill(108), 115];
    expect(williamsR(h, l, c, 14).at(-1)).toBeCloseTo(-25, 10);
    expect(highsLows(h, l, c, 14).at(-1)).toBeCloseTo(5, 10);
    expect(williamsR(h, l, c, 14)[12]).toBeNull();
  });
});

describe('cci (cci@1)', () => {
  it('typical prices 1, 2, 3 give (3 - 2) / (0.015 x 2/3) = 100; flat is null', () => {
    expect(cci([1, 2, 3], [1, 2, 3], [1, 2, 3], 3).at(-1)).toBeCloseTo(100, 10);
    expect(cci([1, 1, 1], [1, 1, 1], [1, 1, 1], 3).at(-1)).toBeNull();
  });
});

describe('roc (roc@1)', () => {
  it('100 to 110 over 12 bars is +10%', () => {
    expect(roc([100, ...Array<number>(11).fill(105), 110], 12).at(-1)).toBeCloseTo(10, 10);
    expect(roc([1, 2], 12).at(-1)).toBeNull();
  });
});

describe('stochastic (stoch-slow@1)', () => {
  it('closes 1, 2, 3, 2 with k 3 and smoothing 2 give (100 + 0) / 2', () => {
    const c = [1, 2, 3, 2];
    const s = stochastic(c, c, c, 3, 2);
    expect(s).toEqual([null, null, null, 50]);
  });
});

describe('ultimateOscillator (ultimate-7-14-28@1)', () => {
  it('is 50 when every bar buys half its true range, first at index 28', () => {
    // Each bar: previous close = today's low, so buying pressure 1 and true range 2.
    const r = rising(40);
    const u = ultimateOscillator(r.h, r.l, r.c);
    expect(u.at(-1)).toBeCloseTo(50, 10);
    expect(u[27]).toBeNull();
    expect(u[28]).toBeCloseTo(50, 10);
  });
});

describe('bullBearPower (elder-power@1)', () => {
  it('is 0 on a flat series with a symmetric range', () => {
    const n = 20;
    const s = bullBearPower(
      Array<number>(n).fill(101),
      Array<number>(n).fill(99),
      Array<number>(n).fill(100),
      13,
    );
    expect(s.at(-1)).toBe(0);
    expect(s[11]).toBeNull();
  });
});

describe('stochRsi (stochrsi@1)', () => {
  it('places RSI in its own 14-bar range, and is null when RSI is flat', () => {
    const c = Array.from({ length: 60 }, (_, i) => 100 + 10 * Math.sin(i / 3));
    const r = rsi(c, 14).slice(-14) as number[];
    const want =
      (((r.at(-1) as number) - Math.min(...r)) / (Math.max(...r) - Math.min(...r))) * 100;
    expect(stochRsi(c, 14).at(-1)).toBeCloseTo(want, 10);
    expect(stochRsi(c, 14)[26]).toBeNull();
    expect(stochRsi(rising(40).c, 14).at(-1)).toBeNull();
  });
});
