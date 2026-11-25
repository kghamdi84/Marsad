import { describe, expect, it } from 'vitest';
import { QUALITY_MIN_UNIVERSE, percentiles, qualityScreen, type QualityInput } from './quality.js';

describe('percentiles', () => {
  it('ranks lowest 0 and highest 100, spacing evenly', () => {
    // n = 5: ranks 0..4 over 4 steps of 25.
    expect(percentiles([30, 10, 50, 20, 40])).toEqual([50, 0, 100, 25, 75]);
  });
  it('gives ties the average of their ranks', () => {
    // Ranks 0 and (1, 2 tied -> 1.5) and 3, over 3 steps: 0, 50, 50, 100.
    expect(percentiles([1, 2, 2, 3])).toEqual([0, 50, 50, 100]);
  });
  it('a single value sits in the middle', () => {
    expect(percentiles([7])).toEqual([50]);
  });
});

// Company i (0..30): every measure improves with i, so its percentile on every measure is i / 30 x 100.
const ladder = (i: number): QualityInput => ({
  ticker: `T${String(i).padStart(2, '0')}`,
  cik: String(1000 + i).padStart(10, '0'),
  name: `Company ${i}`,
  grossProfit: 10 + i, // gross profitability (10 + i) / 100
  netIncome: 1 + i, // ROA (1 + i) / 100; earnings yield (1 + i) / 1
  operatingCashFlow: 1 + 2 * i, // accruals (NI - CFO) / 100 = -i / 100: lower is better
  assets: 100,
  liabilities: 90 - i, // leverage (90 - i) / 100: lower is better
  equity: 10 + i, // book-to-market (10 + i) / 1
  shares: 1,
  price: 1,
});

describe('qualityScreen', () => {
  const universe = Array.from({ length: 31 }, (_, i) => ladder(i));

  it('scores each company by its percentiles; the best passes, the middle does not', () => {
    const s = qualityScreen(universe);
    expect(s.eligible).toBe(31);
    expect(s.insufficient).toBeNull();
    const best = s.ranked[0];
    expect(best?.ticker).toBe('T30');
    expect(best?.quality).toBe(100);
    expect(best?.value).toBe(100);
    expect(best?.passes).toBe(true);
    const mid = s.ranked.find((r) => r.ticker === 'T15');
    // 15 / 30 = 50th percentile on every measure: value 50 meets its bar, quality 50 is below 70.
    expect(mid?.quality).toBe(50);
    expect(mid?.value).toBe(50);
    expect(mid?.passes).toBe(false);
    expect(s.ranked.at(-1)?.ticker).toBe('T00');
    expect(mid?.metrics).toEqual({
      grossProfitability: 0.25,
      roa: 0.16,
      accruals: -0.15,
      leverage: 0.75,
      marketCap: 1,
      earningsYield: 16,
      bookToMarket: 25,
    });
  });

  it('quality alone does not pass: cheapness is required too', () => {
    // T30 made expensive: price 1000 cuts its earnings yield and book-to-market to the bottom.
    const s = qualityScreen(universe.map((u) => (u.ticker === 'T30' ? { ...u, price: 1000 } : u)));
    const t30 = s.ranked.find((r) => r.ticker === 'T30');
    expect(t30?.quality).toBe(100);
    expect(t30?.value).toBe(0);
    expect(t30?.passes).toBe(false);
  });

  it('counts every exclusion by reason and ranks nobody under 30 eligible companies', () => {
    const bad: QualityInput[] = [
      { ...ladder(1), ticker: 'BANK', grossProfit: null },
      { ...ladder(2), ticker: 'LOSS', netIncome: -5 },
      { ...ladder(3), ticker: 'NEGQ', equity: -1 },
      { ...ladder(4), ticker: 'NOPX', price: null },
      { ...ladder(5), ticker: 'GAPS', assets: null },
    ];
    const s = qualityScreen([...universe.slice(0, QUALITY_MIN_UNIVERSE - 1), ...bad]);
    expect(s.excluded).toEqual({
      'missing-data': 1,
      'no-gross-profit': 1,
      'not-profitable': 1,
      'negative-equity': 1,
      'no-price': 1,
    });
    expect(s.eligible).toBe(29);
    expect(s.ranked).toEqual([]);
    expect(s.insufficient).toBe(
      'Only 29 companies have every input (at least 30 are needed for a ranking).',
    );
  });
});
