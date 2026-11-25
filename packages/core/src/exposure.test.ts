import { describe, expect, it } from 'vitest';
import ref from '../../../fixtures/exposure/exposure-reference.json';
import {
  beta,
  correlationPairs,
  exposureReport,
  vixSensitivity,
  type PositionExposure,
} from './exposure.js';
import type { DailyBar } from './study.js';

const bars = (dates: readonly string[], closes: readonly number[]): DailyBar[] =>
  closes.map((c, i) => ({
    date: dates[i] as string,
    open: c,
    high: c,
    low: c,
    close: c,
    volume: 1,
    vwap: null,
  }));
const spy = bars(ref.dates, ref.spy);
const sector = bars(ref.dates, ref.sector);
const stock = bars(ref.dates, ref.stock);
const other = bars(ref.other.dates, ref.other.closes);
const vix = ref.vix.map((value, i) => ({ date: ref.dates[i] as string, value }));
const E = ref.expected;

describe('beta and sensitivities (numpy known answers, tolerance 1e-10)', () => {
  it('beta to SPY and to the sector ETF over the last 252 returns', () => {
    const b = beta(stock, spy);
    expect(b?.n).toBe(252);
    expect(b?.slope).toBeCloseTo(E.stockBetaSpy, 10);
    expect(b?.correlation).toBeCloseTo(E.stockCorrSpy, 10);
    expect(beta(stock, sector)?.slope).toBeCloseTo(E.stockBetaSector, 10);
  });

  it('aligns on common dates when one series misses a session', () => {
    const b = beta(other, spy);
    expect(b?.n).toBe(E.otherBetaN);
    expect(b?.slope).toBeCloseTo(E.otherBetaSpy, 10);
  });

  it('VIX sensitivity: daily return per VIX point', () => {
    expect(vixSensitivity(stock, vix)?.slope).toBeCloseTo(E.stockVixSensitivity, 10);
  });

  it('returns null with fewer than 60 common sessions', () => {
    expect(beta(stock.slice(0, 50), spy)).toBeNull();
  });

  it('correlation pairs over 126 sessions, sorted, flagged at 0.8', () => {
    const pairs = correlationPairs([
      { ticker: 'STK', bars: stock },
      { ticker: 'OTH', bars: other },
      { ticker: 'STK2', bars: stock },
    ]);
    expect(pairs[0]).toMatchObject({ a: 'STK', b: 'STK2', high: true });
    expect(pairs[0]?.correlation).toBeCloseTo(1, 12);
    const so = pairs.find((p) => p.a === 'STK' && p.b === 'OTH');
    expect(so?.n).toBe(E.corrN);
    expect(so?.correlation).toBeCloseTo(E.corrStockOther126, 10);
    expect(so?.high).toBe(false);
  });
});

describe('exposureReport (hand-checked)', () => {
  const p = (
    ticker: string,
    shares: number,
    price: number,
    extra: Partial<PositionExposure> = {},
  ): PositionExposure => ({
    ticker,
    shares,
    price,
    sectorEtf: null,
    beta: 1,
    vixSensitivity: null,
    sectorBeta: null,
    ...extra,
  });
  // Values: NVDA 100 x 150 = 15,000; RKLB 400 x 25 = 10,000; SPY 50 x 500 = 25,000. Total 50,000.
  const r = exposureReport([
    p('NVDA', 100, 150, { sectorEtf: 'XLK', beta: 2, sectorBeta: 1.5, vixSensitivity: -0.004 }),
    p('RKLB', 400, 25, { sectorEtf: 'XLI', beta: null, vixSensitivity: -0.006 }),
    p('SPY', 50, 500, { beta: 1, vixSensitivity: -0.002 }),
  ]);

  it('weights, sectors and concentration', () => {
    expect(r.totalValue).toBe(50_000);
    expect(r.positions.map((x) => [x.ticker, x.weight])).toEqual([
      ['SPY', 0.5],
      ['NVDA', 0.3],
      ['RKLB', 0.2],
    ]);
    expect(r.sectors.map((s) => [s.sector, s.weight])).toEqual([
      ['Unassigned', 0.5],
      ['Technology', 0.3],
      ['Industrials', 0.2],
    ]);
    // HHI = 0.25 + 0.09 + 0.04 = 0.38; effective positions 1 / 0.38 = 2.6316.
    expect(r.concentration.hhi).toBeCloseTo(0.38, 12);
    expect(r.concentration.effectivePositions).toBeCloseTo(1 / 0.38, 12);
    expect(r.concentration.largest).toEqual({ ticker: 'SPY', weight: 0.5 });
    expect(r.concentration.top3Weight).toBeCloseTo(1, 12);
  });

  it('beta-weighted exposure counts a missing beta as 1 and says so', () => {
    // 15,000 x 2 + 10,000 x 1 (assumed) + 25,000 x 1 = 65,000; portfolio beta 1.3.
    expect(r.betaDollars).toBe(65_000);
    expect(r.portfolioBeta).toBeCloseTo(1.3, 12);
    expect(r.betaAssumed).toEqual(['RKLB']);
  });

  it('stress scenarios are linear approximations with their assumptions', () => {
    const s = Object.fromEntries(r.scenarios.map((x) => [x.name, x]));
    expect(s['SPY down 10%']?.usd).toBeCloseTo(-6_500, 9);
    expect(s['SPY down 20%']?.pct).toBeCloseTo(-0.26, 12);
    expect(s['SPY down 5%']?.assumptions).toContain('Beta counted as 1 for RKLB.');
    // VIX +10: 15,000 x -0.04 + 10,000 x -0.06 + 25,000 x -0.02 = -600 - 600 - 500 = -1,700.
    expect(s['VIX up 10 points']?.usd).toBeCloseTo(-1_700, 9);
    // Technology shock: 15,000 x 1.5 x -0.10 = -2,250. Industrials: 10,000 x 1 (assumed) x -0.10 = -1,000.
    expect(s['Technology (XLK) down 10%']?.usd).toBeCloseTo(-2_250, 9);
    expect(s['Industrials (XLI) down 10%']?.usd).toBeCloseTo(-1_000, 9);
    expect(s['Industrials (XLI) down 10%']?.assumptions).toContain(
      'Beta to XLI counted as 1 for RKLB.',
    );
    expect(r.scenarios.some((x) => x.name.startsWith('Unassigned'))).toBe(false);
  });

  it('an empty portfolio reports zeros, not NaN', () => {
    const e = exposureReport([]);
    expect(e.totalValue).toBe(0);
    expect(e.portfolioBeta).toBe(0);
    expect(e.concentration).toEqual({
      largest: null,
      top3Weight: 0,
      hhi: 0,
      effectivePositions: 0,
    });
  });
});
