import { describe, expect, it } from 'vitest';
import ref from '../../../fixtures/exposure/exposure-reference.json';
import { relativeStrength, rotationSignal, trendOf } from './rotation.js';
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
const E = ref.expected;

describe('relativeStrength (numpy known answers, tolerance 1e-12)', () => {
  it('3, 6 and 12 months against the sector ETF and SPY', () => {
    expect(relativeStrength(stock, sector, 63)).toBeCloseTo(E.rsStockSector.m3, 12);
    expect(relativeStrength(stock, sector, 126)).toBeCloseTo(E.rsStockSector.m6, 12);
    expect(relativeStrength(stock, sector, 252)).toBeCloseTo(E.rsStockSector.m12, 12);
    expect(relativeStrength(stock, spy, 126)).toBeCloseTo(E.rsStockSpy.m6, 12);
  });

  it('is null without enough common history', () => {
    expect(relativeStrength(stock.slice(-100), spy, 126)).toBeNull();
  });
});

describe('rotationSignal', () => {
  const base = { ticker: 'STK', bars: stock, spy, sectorEtf: 'XLK', sectorBars: sector };

  it('lagging with a weakening thesis suggests the sector ETF or SPY', () => {
    const r = rotationSignal({ ...base, thesis: 'weakening' });
    expect(r.lagging).toBe(true);
    expect(r.suggestion).toBe('rotate');
    expect(r.text).toBe(
      'Lags: -5.0% over 3 months and -13.9% over 6 months against XLK, -17.5% over 6 months against SPY, and the thesis is weakening. Consider XLK or SPY instead.',
    );
  });

  it('lagging with the thesis intact does not hold by default: it states the trend and the exit rules', () => {
    const r = rotationSignal({ ...base, thesis: 'intact' });
    expect(r.trend).toBe(trendOf(stock));
    expect(['review', 'none']).toContain(r.suggestion);
    expect(r.text).toMatch(
      r.suggestion === 'review' ? /review the thesis/ : /exit rules still apply/,
    );
  });

  it('without a sector ETF it compares with SPY', () => {
    const r = rotationSignal({ ...base, sectorEtf: null, sectorBars: null, thesis: 'broken' });
    expect(r.vsSector).toBeNull();
    expect(r.text).toContain('against SPY, -17.5%');
    expect(r.text).toMatch(/Consider SPY instead\.$/);
  });

  it('a stock beating its benchmarks is not lagging', () => {
    const r = rotationSignal({ ...base, bars: sector, sectorBars: stock, thesis: 'broken' });
    expect(r.lagging).toBe(false);
    expect(r.suggestion).toBe('none');
  });

  it('too little history is insufficient, not a signal', () => {
    const r = rotationSignal({ ...base, bars: stock.slice(-100), thesis: 'broken' });
    expect(r.suggestion).toBe('insufficient');
  });
});

describe('trendOf (hand-checked)', () => {
  const line = (n: number, f: (i: number) => number) =>
    bars(
      Array.from({ length: n }, (_, i) => `2026-01-${String(i).padStart(3, '0')}`),
      Array.from({ length: n }, (_, i) => f(i)),
    );
  it('rising line is up, falling line is down, under 200 bars is null', () => {
    expect(trendOf(line(210, (i) => 100 + i))).toBe('up');
    expect(trendOf(line(210, (i) => 400 - i))).toBe('down');
    expect(trendOf(line(150, (i) => 100 + i))).toBeNull();
  });
});
