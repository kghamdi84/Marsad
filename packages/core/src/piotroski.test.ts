import { describe, expect, it } from 'vitest';
import type { FinancialFact } from './adapters/sec-facts.js';
import { STUDY_CONCEPTS } from './fundamentals.js';
import { PIOTROSKI_CONCEPTS, PIOTROSKI_VERSION, piotroskiScore } from './piotroski.js';

// A made-up company with calendar fiscal years; every figure is chosen so the answers can be checked by hand.
// FY2024 facts were filed 2025-02-15 (accession A1), FY2025 facts 2026-02-15 (A2).
const A1 = { accession: '0000000000-25-000001', filed: '2025-02-15' };
const A2 = { accession: '0000000000-26-000001', filed: '2026-02-15' };
const fact = (
  concept: string,
  start: string | null,
  end: string,
  value: number,
  f: { accession: string; filed: string },
  unit = 'USD',
): FinancialFact => ({
  taxonomy: 'us-gaap',
  concept,
  unit,
  start,
  end,
  value,
  accession: f.accession,
  form: '10-K',
  fy: null,
  fp: 'FY',
  filed: f.filed,
  frame: null,
});
const Y24: [string, string] = ['2024-01-01', '2024-12-31'];
const Y25: [string, string] = ['2025-01-01', '2025-12-31'];
const E2 = '2023-12-31';
const E1 = '2024-12-31';
const E0 = '2025-12-31';

const BASE: FinancialFact[] = [
  // Total assets 800, 1,000, 1,200 at the three year ends.
  fact('Assets', null, E2, 800, A1),
  fact('Assets', null, E1, 1000, A1),
  fact('Assets', null, E0, 1200, A2),
  // Net income 60 then 120; operating cash flow 50 then 150.
  fact('NetIncomeLoss', ...Y24, 60, A1),
  fact('NetIncomeLoss', ...Y25, 120, A2),
  fact('NetCashProvidedByUsedInOperatingActivities', ...Y24, 50, A1),
  fact('NetCashProvidedByUsedInOperatingActivities', ...Y25, 150, A2),
  // Long-term debt (noncurrent) 300, 320, 300.
  fact('LongTermDebtNoncurrent', null, E2, 300, A1),
  fact('LongTermDebtNoncurrent', null, E1, 320, A1),
  fact('LongTermDebtNoncurrent', null, E0, 300, A2),
  // Current ratio 400 / 250 = 1.6, then 500 / 250 = 2.0.
  fact('AssetsCurrent', null, E1, 400, A1),
  fact('LiabilitiesCurrent', null, E1, 250, A1),
  fact('AssetsCurrent', null, E0, 500, A2),
  fact('LiabilitiesCurrent', null, E0, 250, A2),
  // Diluted shares 100 then 105 (dilution).
  fact('WeightedAverageNumberOfDilutedSharesOutstanding', ...Y24, 100, A1, 'shares'),
  fact('WeightedAverageNumberOfDilutedSharesOutstanding', ...Y25, 105, A2, 'shares'),
  // Revenue 900 then 1,000; gross profit 405 (45%) then 420 (42%).
  fact('Revenues', ...Y24, 900, A1),
  fact('Revenues', ...Y25, 1000, A2),
  fact('GrossProfit', ...Y24, 405, A1),
  fact('GrossProfit', ...Y25, 420, A2),
];

const byId = (r: ReturnType<typeof piotroskiScore>) => new Map(r.tests.map((x) => [x.id, x]));

describe('piotroski-1 F-score', () => {
  it('scores the hand-checked company 6 of 9 with each test, figure and period', () => {
    const r = piotroskiScore(BASE, '2026-03-01');
    expect(r.formulaVersion).toBe(PIOTROSKI_VERSION);
    expect(r.year).toEqual({ start: '2025-01-01', end: '2025-12-31' });
    expect(r.priorYear).toEqual({ start: '2024-01-01', end: '2024-12-31' });
    expect(r.filed).toBe(A2.filed);
    expect(r.accession).toBe(A2.accession);
    const t = byId(r);
    const tol = 1e-12;
    // 1. ROA 120 / 1,000 = 0.12 > 0.
    expect(t.get('roa-positive')?.passed).toBe(true);
    expect(t.get('roa-positive')?.current).toBeCloseTo(0.12, 12);
    // 2. Operating cash flow 150 > 0.
    expect(t.get('cfo-positive')).toMatchObject({ passed: true, current: 150, prior: 0 });
    // 3. ROA 0.12 against 60 / 800 = 0.075.
    expect(t.get('roa-up')?.passed).toBe(true);
    expect(Math.abs((t.get('roa-up')?.prior ?? 0) - 0.075)).toBeLessThan(tol);
    // 4. Cash flow over assets 150 / 1,000 = 0.15 against ROA 0.12.
    expect(t.get('accruals')?.passed).toBe(true);
    expect(Math.abs((t.get('accruals')?.current ?? 0) - 0.15)).toBeLessThan(tol);
    // 5. Leverage 300 / 1,100 = 0.272727 against 320 / 900 = 0.355556.
    expect(t.get('leverage-down')?.passed).toBe(true);
    expect(Math.abs((t.get('leverage-down')?.current ?? 0) - 300 / 1100)).toBeLessThan(tol);
    expect(Math.abs((t.get('leverage-down')?.prior ?? 0) - 320 / 900)).toBeLessThan(tol);
    // 6. Current ratio 2.0 against 1.6.
    expect(t.get('current-ratio-up')).toMatchObject({ passed: true, current: 2, prior: 1.6 });
    // 7. Shares rose 100 to 105: fails.
    expect(t.get('no-dilution')).toMatchObject({ passed: false, current: 105, prior: 100 });
    // 8. Gross margin 0.42 against 0.45: fails.
    expect(t.get('gross-margin-up')).toMatchObject({ passed: false, current: 0.42, prior: 0.45 });
    // 9. Asset turnover 1,000 / 1,000 = 1.0 against 900 / 800 = 1.125: fails.
    expect(t.get('asset-turnover-up')).toMatchObject({ passed: false, current: 1, prior: 1.125 });

    expect(r.score).toBe(6);
    expect(r.passed).toBe(6);
    expect(r.available).toBe(9);
    expect(r.groups).toEqual({
      profitability: { passed: 4, available: 4, of: 4 },
      leverage: { passed: 2, available: 3, of: 3 },
      efficiency: { passed: 0, available: 2, of: 2 },
    });
  });

  it('marks a test not available when an input is missing, and gives no full score', () => {
    const r = piotroskiScore(
      BASE.filter((f) => f.concept !== 'AssetsCurrent'),
      '2026-03-01',
    );
    const cr = byId(r).get('current-ratio-up');
    expect(cr?.passed).toBeNull();
    expect(cr?.missing).toEqual(['current assets', 'prior current assets']);
    expect(r.score).toBeNull();
    expect(r.available).toBe(8);
    expect(r.passed).toBe(5);
    expect(r.groups.leverage).toEqual({ passed: 1, available: 2, of: 3 });
  });

  it('uses only filings known on the date (no look-ahead)', () => {
    // Before the FY2025 10-K: year t is 2024 and there is no stored 2023 year to compare with.
    const r = piotroskiScore(BASE, '2026-01-31');
    expect(r.year).toEqual({ start: '2024-01-01', end: '2024-12-31' });
    expect(r.priorYear).toBeNull();
    const t = byId(r);
    // ROA 60 / 800 = 0.075 > 0; cash flow 50 > 0; 50 / 800 = 0.0625 is below the ROA, so accruals fail.
    expect(t.get('roa-positive')?.passed).toBe(true);
    expect(t.get('cfo-positive')?.passed).toBe(true);
    expect(t.get('accruals')?.passed).toBe(false);
    expect(t.get('roa-up')?.passed).toBeNull();
    expect(r.available).toBe(3);
    expect(r.score).toBeNull();
    expect(r.filed).toBe(A1.filed);
  });

  it('passes the leverage test when there is no long-term debt in either year', () => {
    const r = piotroskiScore(
      BASE.map((f) => (f.concept === 'LongTermDebtNoncurrent' ? { ...f, value: 0 } : f)),
      '2026-03-01',
    );
    expect(byId(r).get('leverage-down')).toMatchObject({ passed: true, current: 0, prior: 0 });
  });

  it('returns nothing to score with no facts', () => {
    const r = piotroskiScore([], '2026-03-01');
    expect(r.year).toBeNull();
    expect(r.available).toBe(0);
    expect(r.score).toBeNull();
    expect(r.tests).toHaveLength(9);
  });

  it('reads only concepts the facts job stores', () => {
    for (const c of PIOTROSKI_CONCEPTS) expect(STUDY_CONCEPTS['us-gaap']).toContain(c);
  });
});
