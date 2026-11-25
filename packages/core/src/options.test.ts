import { describe, expect, it } from 'vitest';
import ref from '../../../fixtures/options/bsm-reference.json';
import {
  bsGreeks,
  bsPrice,
  expectedMove,
  impliedVol,
  ivPercentile,
  ivRank,
  liquidityOk,
  payoffAt,
  payoffSummary,
  type BsInput,
  type Leg,
} from './options.js';

const cases = ref.cases as { input: BsInput; expected: Record<string, number> }[];

describe('Black-Scholes-Merton against scipy', () => {
  it('prices and greeks within 1e-9', () => {
    for (const c of cases) {
      expect(
        Math.abs(bsPrice(c.input) - (c.expected['price'] as number)),
        JSON.stringify(c.input),
      ).toBeLessThan(1e-9);
      const g = bsGreeks(c.input);
      for (const k of ['delta', 'gamma', 'vega', 'theta', 'rho'] as const)
        expect(
          Math.abs(g[k] - (c.expected[k] as number)),
          `${k} ${JSON.stringify(c.input)}`,
        ).toBeLessThan(1e-9);
    }
  });
  it('the textbook call: 100, 100, 1 year, 5%, 20% is 10.4506', () => {
    expect(bsPrice({ s: 100, k: 100, t: 1, r: 0.05, q: 0, sigma: 0.2, type: 'call' })).toBeCloseTo(
      10.4506,
      4,
    );
  });
  it('put-call parity holds', () => {
    for (const c of cases.filter((x) => x.input.type === 'call')) {
      const x = c.input;
      const call = bsPrice(x);
      const put = bsPrice({ ...x, type: 'put' });
      expect(call - put).toBeCloseTo(x.s * Math.exp(-x.q * x.t) - x.k * Math.exp(-x.r * x.t), 9);
    }
  });
});

describe('implied volatility', () => {
  it('recovers the volatility from every reference price', () => {
    for (const c of cases) {
      const { sigma, ...rest } = c.input;
      expect(
        Math.abs((impliedVol(c.expected['price'] as number, rest) ?? 0) - sigma),
        JSON.stringify(c.input),
      ).toBeLessThan(1e-7);
    }
  });
  it('returns null outside the no-arbitrage bounds', () => {
    const x = { s: 100, k: 100, t: 1, r: 0.05, q: 0, type: 'call' as const };
    expect(impliedVol(0, x)).toBeNull();
    expect(impliedVol(100, x)).toBeNull(); // a call is worth less than the stock
    expect(impliedVol(4.8, x)).toBeNull(); // below intrinsic value 100 - 100 e^-0.05 = 4.877
  });
});

describe('expected move, IV rank and percentile (hand-checked)', () => {
  it('expected move from the straddle', () => {
    expect(expectedMove(6.3, 210)).toEqual({ usd: 6.3, pct: 0.03 });
  });
  it('IV rank and percentile', () => {
    const hist = [0.2, 0.3, 0.4, 0.5, 0.6];
    expect(ivRank(hist, 0.3)).toBeCloseTo(25, 12); // (0.3 - 0.2) / (0.6 - 0.2)
    expect(ivPercentile(hist, 0.45)).toBe(60); // 3 of 5 days below
    expect(ivRank([0.3, 0.3], 0.3)).toBeNull();
    expect(ivPercentile([], 0.3)).toBeNull();
  });
});

describe('payoffs (hand-checked)', () => {
  it('a bull call spread: max loss 200, max gain 800, breakeven 102', () => {
    const legs: Leg[] = [
      { type: 'call', strike: 100, qty: 1, price: 3 },
      { type: 'call', strike: 110, qty: -1, price: 1 },
    ];
    expect(payoffAt(legs, 95)).toBe(-200);
    expect(payoffAt(legs, 120)).toBe(800);
    expect(payoffSummary(legs)).toEqual({
      maxLoss: -200,
      maxGain: 800,
      breakevens: [102],
      definedRisk: true,
    });
  });
  it('an iron condor: credit 1.50, wings 5 wide', () => {
    // Short 95P and 105C, long 90P and 110C; credit 1.50 a share: max gain 150, max loss (5 - 1.5) x 100 = 350.
    const legs: Leg[] = [
      { type: 'put', strike: 90, qty: 1, price: 0.5 },
      { type: 'put', strike: 95, qty: -1, price: 1.25 },
      { type: 'call', strike: 105, qty: -1, price: 1.25 },
      { type: 'call', strike: 110, qty: 1, price: 0.5 },
    ];
    expect(payoffSummary(legs)).toEqual({
      maxLoss: -350,
      maxGain: 150,
      breakevens: [93.5, 106.5],
      definedRisk: true,
    });
  });
  it('a naked short call has unlimited loss and is not defined risk', () => {
    const s = payoffSummary([{ type: 'call', strike: 100, qty: -1, price: 2 }]);
    expect(s).toMatchObject({ maxLoss: null, maxGain: 200, definedRisk: false, breakevens: [102] });
  });
  it('a long call has unlimited gain', () => {
    expect(payoffSummary([{ type: 'call', strike: 50, qty: 1, price: 4 }])).toMatchObject({
      maxLoss: -400,
      maxGain: null,
      breakevens: [54],
    });
  });
});

describe('liquidity guard', () => {
  it('needs a two-sided quote within 10% of the mid and open interest', () => {
    expect(liquidityOk(1.0, 1.08, 500).ok).toBe(true); // 0.08 / 1.04 = 7.7%
    expect(liquidityOk(1.0, 1.2, 500)).toEqual({
      ok: false,
      reason: 'spread 18.2% of the mid, above 10%',
    });
    expect(liquidityOk(1.0, 1.05, 20)).toEqual({
      ok: false,
      reason: 'open interest 20, below 100',
    });
    expect(liquidityOk(0, 0.05, 1000).ok).toBe(false);
  });
});
