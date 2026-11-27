import { describe, expect, it } from 'vitest';
import type { FinancialFact } from './adapters/sec-facts.js';
import { SNAPSHOT_VERSION, companySnapshot } from './snapshot.js';

// A made-up company with eight calendar quarters, every figure chosen so the answers can be checked by hand.
const fact = (
  concept: string,
  start: string | null,
  end: string,
  value: number,
  filed: string,
  unit = 'USD',
  taxonomy = 'us-gaap',
): FinancialFact => ({
  taxonomy,
  concept,
  unit,
  start,
  end,
  value,
  accession: `0000000000-${filed.slice(2, 4)}-${filed.slice(5, 7)}${filed.slice(8, 10)}00`,
  form: '10-Q',
  fy: Number(end.slice(0, 4)),
  fp: 'Q',
  filed,
  frame: null,
});

// [start, end, filed]: each quarter is filed about five weeks after it ends.
const QUARTERS: [string, string, string][] = [
  ['2024-01-01', '2024-03-31', '2024-05-06'],
  ['2024-04-01', '2024-06-30', '2024-08-05'],
  ['2024-07-01', '2024-09-30', '2024-11-04'],
  ['2024-10-01', '2024-12-31', '2025-02-10'],
  ['2025-01-01', '2025-03-31', '2025-05-05'],
  ['2025-04-01', '2025-06-30', '2025-08-04'],
  ['2025-07-01', '2025-09-30', '2025-11-03'],
  ['2025-10-01', '2025-12-31', '2026-02-09'],
];
// Revenue 10, 11, ..., 17 (in billions); net income 2 every quarter.
const FACTS: FinancialFact[] = [
  ...QUARTERS.map(([s, e, f], i) => fact('Revenues', s, e, (10 + i) * 1e9, f)),
  ...QUARTERS.map(([s, e, f]) => fact('NetIncomeLoss', s, e, 2e9, f)),
  fact(
    'EntityCommonStockSharesOutstanding',
    null,
    '2026-01-31',
    1e9,
    '2026-02-09',
    'shares',
    'dei',
  ),
];

describe('companySnapshot: market value, revenue over four quarters, its change and the net margin', () => {
  it('sums the newest four quarters and compares them with the four a year earlier', () => {
    const s = companySnapshot(FACTS, '2026-03-01', 50);
    expect(s.formulaVersion).toBe(SNAPSHOT_VERSION);
    // 14 + 15 + 16 + 17 = 62 billion, ending 2025-12-31.
    expect(s.revenueTtm?.value).toBe(62e9);
    expect(s.revenueTtmEnd).toBe('2025-12-31');
    // Against 10 + 11 + 12 + 13 = 46 billion: 62 / 46 - 1 = 34.7826...%.
    expect(s.revenueTtmYoYPct).toBeCloseTo(34.7826, 3);
    // Net income 4 x 2 = 8 billion over 62 billion = 12.9032...%.
    expect(s.netMarginTtmPct).toBeCloseTo(12.9032, 3);
    // 50 x 1 billion shares.
    expect(s.marketValue).toBe(50e9);
    expect(s.sharesOutstanding).toEqual({ end: '2026-01-31', value: 1e9 });
  });

  it('uses only what was filed by the date chosen (no look-ahead)', () => {
    // On 2025-12-01 the newest filed quarter ends 2025-09-30: 13 + 14 + 15 + 16 = 58 billion.
    const s = companySnapshot(FACTS, '2025-12-01', 50);
    expect(s.revenueTtm?.value).toBe(58e9);
    expect(s.revenueTtmEnd).toBe('2025-09-30');
    // The four quarters a year earlier would need the quarter to 2023-12-31, which was never filed.
    expect(s.revenueTtmYoYPct).toBeNull();
    expect(s.netMarginTtmPct).toBeCloseTo((8 / 58) * 100, 6);
    // The cover page with the share count was filed after this date.
    expect(s.marketValue).toBeNull();
  });

  it('says nothing rather than guessing when inputs are missing', () => {
    expect(companySnapshot([], '2026-03-01', 50)).toEqual({
      asOf: '2026-03-01',
      formulaVersion: SNAPSHOT_VERSION,
      marketValue: null,
      sharesOutstanding: null,
      revenueTtm: null,
      revenueTtmEnd: null,
      revenueTtmYoYPct: null,
      netMarginTtmPct: null,
    });
    // No price: no market value, everything else still computed.
    const noPrice = companySnapshot(FACTS, '2026-03-01', null);
    expect(noPrice.marketValue).toBeNull();
    expect(noPrice.revenueTtm?.value).toBe(62e9);
  });

  it('gives no margin when net income is missing for one of the same four quarters', () => {
    const gap = FACTS.filter((f) => !(f.concept === 'NetIncomeLoss' && f.end === '2025-12-31'));
    const s = companySnapshot(gap, '2026-03-01', 50);
    expect(s.revenueTtm?.value).toBe(62e9);
    expect(s.netMarginTtmPct).toBeNull();
  });
});
