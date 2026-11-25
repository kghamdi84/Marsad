import { describe, expect, it } from 'vitest';
import ref from '../../../fixtures/stats/reference.json';
import {
  MIN_CASES,
  bootstrap,
  deflatedSharpe,
  kurtosis,
  maxDrawdown,
  mean,
  mulberry32,
  normCdf,
  normInv,
  quantileSorted,
  sharpe,
  skewness,
  stdev,
  tradeStats,
  wilson,
} from './stats.js';

// Expected values from scipy 1.18, statsmodels 0.15 and numpy 2.5 (fixtures/stats/reference.json).
const r = ref.returns;

describe('normal distribution against scipy', () => {
  it('normCdf within 1e-14 absolute', () => {
    for (const [x, p] of ref.cdf as [number, number][])
      expect(Math.abs(normCdf(x) - p), String(x)).toBeLessThan(1e-14);
  });
  it('normInv within 1e-9 absolute', () => {
    for (const [p, x] of ref.inv as [number, number][])
      expect(Math.abs(normInv(p) - x), String(p)).toBeLessThan(1e-9);
  });
  it('rejects p outside (0, 1)', () => {
    expect(() => normInv(0)).toThrow(RangeError);
    expect(() => normInv(1)).toThrow(RangeError);
  });
});

describe('Wilson interval against statsmodels', () => {
  it('90% within 1e-12', () => {
    for (const [k, n, lo, hi] of ref.wilson90 as [number, number, number, number][]) {
      const w = wilson(k, n);
      expect(Math.abs((w?.low ?? NaN) - lo), `${k}/${n}`).toBeLessThan(1e-12);
      expect(Math.abs((w?.high ?? NaN) - hi), `${k}/${n}`).toBeLessThan(1e-12);
    }
  });
  it('95% within 1e-12', () => {
    for (const [k, n, lo, hi] of ref.wilson95 as [number, number, number, number][]) {
      const w = wilson(k, n, 0.95);
      expect(Math.abs((w?.low ?? NaN) - lo)).toBeLessThan(1e-12);
      expect(Math.abs((w?.high ?? NaN) - hi)).toBeLessThan(1e-12);
    }
  });
  it('a rate near the brief\u2019s example (97 of 212, 45.8%) is about 40% to 52% at 90%; no trials gives null', () => {
    // The exact bounds for 97 of 212 are in the statsmodels reference above.
    const w = wilson(97, 212);
    expect((w?.low ?? 0) * 100).toBeGreaterThan(40);
    expect((w?.high ?? 0) * 100).toBeLessThan(52);
    expect(wilson(0, 0)).toBeNull();
  });
});

describe('moments, Sharpe, drawdown and trade statistics against numpy and scipy', () => {
  it('mean, sample stdev, skewness and kurtosis within 1e-12 relative', () => {
    expect(mean(r)).toBeCloseTo(ref.mean, 14);
    expect(stdev(r) / ref.stdev - 1).toBeLessThan(1e-12);
    expect(Math.abs(skewness(r) - ref.skew)).toBeLessThan(1e-10);
    expect(Math.abs(kurtosis(r) - ref.kurt)).toBeLessThan(1e-10);
  });
  it('Sharpe per period and annualized', () => {
    expect(Math.abs(sharpe(r) - ref.sharpe)).toBeLessThan(1e-12);
    expect(Math.abs(sharpe(r, 252) - ref.sharpeAnnual)).toBeLessThan(1e-10);
  });
  it('maximum drawdown', () => {
    expect(Math.abs(maxDrawdown(r) - ref.maxDrawdown)).toBeLessThan(1e-12);
    // By hand: +10% then -50% then +20%: peak 1.1, trough 0.55, so -50%.
    expect(maxDrawdown([0.1, -0.5, 0.2])).toBeCloseTo(-0.5, 12);
    expect(maxDrawdown([0.01, 0.02])).toBe(0);
  });
  it('trade statistics', () => {
    const t = tradeStats(r);
    expect(t.n).toBe(250);
    expect(t.sufficient).toBe(true);
    expect(Math.abs((t.winRate ?? 0) - ref.tradeStats.winRate)).toBeLessThan(1e-12);
    expect(Math.abs((t.payoff ?? 0) - ref.tradeStats.payoff)).toBeLessThan(1e-12);
    expect(tradeStats(r.slice(0, MIN_CASES - 1)).sufficient).toBe(false);
    expect(tradeStats([])).toMatchObject({ n: 0, winRate: null, sufficient: false });
  });
});

describe('deflated Sharpe ratio against a scipy implementation of Bailey and Lopez de Prado (2014)', () => {
  it('expected maximum Sharpe and probability for 1, 10, 20 and 100 trials', () => {
    for (const [n, v, sr0, p] of ref.dsr as [number, number, number, number][]) {
      const d = deflatedSharpe(r, n, v);
      expect(Math.abs(d.expectedMax - sr0), `N=${n}`).toBeLessThan(1e-9);
      expect(Math.abs(d.probability - p), `N=${n}`).toBeLessThan(1e-9);
    }
  });
  it('more trials can only lower the probability', () => {
    const ps = [1, 10, 100, 1000].map((n) => deflatedSharpe(r, n, 0.003).probability);
    for (let i = 1; i < ps.length; i++) expect(ps[i]).toBeLessThan(ps[i - 1] as number);
  });
});

describe('seeded bootstrap', () => {
  it('mulberry32 matches an independent Python implementation', () => {
    const g = mulberry32(42);
    for (const v of ref.mulberry32_42_first5 as number[]) expect(g()).toBe(v);
  });
  it('the 90% interval of the mean matches numpy on the same draws', () => {
    const ci = bootstrap(r, mean, { resamples: ref.bootstrapMean.B, seed: ref.bootstrapMean.seed });
    expect(Math.abs((ci?.low ?? NaN) - (ref.bootstrapMean.ci[0] as number))).toBeLessThan(1e-15);
    expect(Math.abs((ci?.high ?? NaN) - (ref.bootstrapMean.ci[1] as number))).toBeLessThan(1e-15);
  });
  it('the same seed gives the same interval; another seed differs', () => {
    const a = bootstrap(r, mean, { seed: 3 });
    expect(bootstrap(r, mean, { seed: 3 })).toEqual(a);
    expect(bootstrap(r, mean, { seed: 4 })).not.toEqual(a);
    expect(bootstrap([1], mean)).toBeNull();
  });
  it('quantile type 7 (hand-checked)', () => {
    expect(quantileSorted([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantileSorted([1, 2, 3, 4], 0.05)).toBeCloseTo(1.15, 12);
  });
});
