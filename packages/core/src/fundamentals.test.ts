import { describe, expect, it } from 'vitest';
import factsFixture from '../../../fixtures/sec/companyfacts-NVDA-trimmed.json';
import { FactsParseError, parseCompanyFacts, type FinancialFact } from './adapters/sec-facts.js';
import {
  FUNDAMENTALS_VERSION,
  peRatio,
  pointInTime,
  preferConcepts,
  quarterlyValues,
  summarizeFinancials,
  trailingFourQuarters,
} from './fundamentals.js';

const nvda = parseCompanyFacts(factsFixture.body);

describe('company facts from the real NVIDIA response (recorded 2026-11-24)', () => {
  it('reads every row with its filing date and accession', () => {
    expect(nvda).toMatchObject({ cik: '0001045810', entityName: 'NVIDIA CORP' });
    expect(nvda.facts.length).toBeGreaterThan(200);
    const q2 = nvda.facts.find(
      (f) => f.concept === 'Revenues' && f.end === '2026-07-26' && f.start === '2026-04-27',
    );
    expect(q2).toMatchObject({
      value: 96_221_000_000,
      form: '10-Q',
      filed: '2026-08-26',
      unit: 'USD',
    });
    expect(q2?.accession).toMatch(/^0001045810-26-\d{6}$/);
  });
  it('rejects a document it cannot read instead of skipping rows', () => {
    const bad = {
      cik: 1,
      entityName: 'X',
      facts: {
        'us-gaap': {
          Revenues: {
            units: { USD: [{ end: '2026-01-01', val: 'lots', accn: 'a', filed: '2026-01-02' }] },
          },
        },
      },
    };
    expect(() => parseCompanyFacts(bad)).toThrow(FactsParseError);
    expect(() => parseCompanyFacts({ nope: true })).toThrow(/Not a company facts document/);
  });
});

describe('summarizeFinancials against an independent computation (Python, same recorded facts)', () => {
  const s = summarizeFinancials(nvda.facts, '2026-12-31');
  const last = s.quarters.at(-1);

  it('takes the newest quarter directly from its 10-Q', () => {
    expect(s.latest).toEqual({ end: '2026-07-26', filed: '2026-08-26' });
    expect(last?.revenue).toMatchObject({
      value: 96_221_000_000,
      derived: false,
      filed: '2026-08-26',
    });
  });
  it('derives the fourth quarter as the year minus nine months and says so', () => {
    const q4 = s.quarters.find((q) => q.end === '2026-01-25');
    // 215,938,000,000 for the year less 147,811,000,000 for nine months.
    expect(q4?.revenue).toMatchObject({
      value: 68_127_000_000,
      derived: true,
      filed: '2026-02-25',
    });
  });
  it('computes margins and growth from the same quarter', () => {
    expect(last?.grossMarginPct).toBeCloseTo(74.97531723844068, 9);
    expect(last?.operatingMarginPct).toBeCloseTo(66.2371000093534, 9);
    expect(last?.netMarginPct).toBeCloseTo(62.03219671381507, 9);
    expect(last?.revenueYoYPct).toBeCloseTo(105.85114348672529, 9); // against 46,743,000,000 a year earlier
  });
  it('sums four consecutive quarters for the trailing year', () => {
    expect(s.ttm?.revenue).toMatchObject({ value: 302_969_000_000, derived: true });
    expect(s.ttm?.epsDiluted.value).toBeCloseTo(7.91, 9);
    // Operating cash flow exists only year to date, so every quarter of it is derived by subtraction.
    expect(s.ttm?.operatingCashFlow).toMatchObject({ value: 134_360_000_000, derived: true });
  });
  it('reports the latest balance sheet and the fiscal years', () => {
    expect(s.balance).toMatchObject({
      end: '2026-07-26',
      assets: { value: 320_272_000_000 },
      liabilities: { value: 91_288_000_000 },
      equity: { value: 228_984_000_000 },
      cash: { value: 22_443_000_000 },
      longTermDebt: { value: 33_366_000_000 },
    });
    expect(s.annual.slice(-2).map((a) => [a.end, a.revenue.value])).toEqual([
      ['2025-01-26', 130_497_000_000],
      ['2026-01-25', 215_938_000_000],
    ]);
    expect(s.formulaVersion).toBe(FUNDAMENTALS_VERSION);
  });
});

describe('point in time: nothing is used before its filing date', () => {
  it('the day before the Q2 10-Q was filed, the newest quarter is Q1', () => {
    const before = summarizeFinancials(nvda.facts, '2026-08-25');
    expect(before.latest).toEqual({ end: '2026-04-26', filed: '2026-05-20' });
    expect(before.quarters.at(-1)?.revenue.value).toBe(81_615_000_000);
    expect(summarizeFinancials(nvda.facts, '2026-08-26').latest?.end).toBe('2026-07-26');
  });
  it('before the earliest recorded filing (2017-11-21) there is nothing to show', () => {
    const none = summarizeFinancials(nvda.facts, '2010-01-01');
    expect(none).toMatchObject({ latest: null, quarters: [], ttm: null, balance: null });
  });
  const base = {
    taxonomy: 'us-gaap',
    concept: 'Revenues',
    unit: 'USD',
    start: '2026-01-01',
    end: '2026-03-31',
    fy: null,
    fp: null,
    form: '10-Q',
    frame: null,
  };
  const fact = (value: number, filed: string, accession: string): FinancialFact => ({
    ...base,
    value,
    filed,
    accession,
  });
  it('a restatement replaces the value only from the day it was filed (hand-built, synthetic)', () => {
    const facts = [fact(100, '2026-05-01', 'A-1'), fact(90, '2026-08-01', 'B-1')];
    expect(pointInTime(facts, '2026-04-30')).toEqual([]);
    expect(pointInTime(facts, '2026-06-01').map((f) => f.value)).toEqual([100]);
    expect(pointInTime(facts, '2026-08-01').map((f) => f.value)).toEqual([90]);
  });
});

describe('quarters, trailing sums and fallbacks', () => {
  const rev = (start: string, end: string, value: number, filed: string): FinancialFact => ({
    taxonomy: 'us-gaap',
    concept: 'Revenues',
    unit: 'USD',
    start,
    end,
    value,
    accession: `acc-${end}`,
    form: '10-Q',
    fy: null,
    fp: null,
    filed,
    frame: null,
  });
  it('refuses a trailing year when the quarters are not consecutive', () => {
    const q = [
      rev('2025-01-01', '2025-03-31', 1, '2025-05-01'),
      rev('2025-04-01', '2025-06-30', 1, '2025-08-01'),
      rev('2025-10-01', '2025-12-31', 1, '2026-02-01'), // the third quarter is missing
      rev('2026-01-01', '2026-03-31', 1, '2026-05-01'),
    ];
    expect(trailingFourQuarters(quarterlyValues(q))).toBeNull();
  });
  it('needs four quarters', () => {
    expect(
      trailingFourQuarters(quarterlyValues([rev('2025-01-01', '2025-03-31', 1, '2025-05-01')])),
    ).toBeNull();
  });
  it('prefers the first concept that has a period and falls back for periods it lacks', () => {
    const a = { ...rev('2025-01-01', '2025-03-31', 10, 'x'), concept: 'Revenues' };
    const b = { ...rev('2025-01-01', '2025-03-31', 99, 'x'), concept: 'Other' };
    const c = { ...rev('2024-01-01', '2024-03-31', 7, 'x'), concept: 'Other' };
    const out = preferConcepts([a, b, c], ['Revenues', 'Other'], 'USD');
    expect(out.map((f) => [f.end, f.value])).toEqual([
      ['2025-03-31', 10],
      ['2024-03-31', 7],
    ]);
  });
});

describe('price to earnings', () => {
  it('divides the price by trailing earnings per share', () => {
    expect(peRatio(188.4, 7.91)).toBeCloseTo(23.81795196, 7);
  });
  it('is null when earnings are zero, negative or missing, because the ratio is not meaningful', () => {
    expect(peRatio(188.4, 0)).toBeNull();
    expect(peRatio(188.4, -1.2)).toBeNull();
    expect(peRatio(188.4, null)).toBeNull();
    expect(peRatio(0, 5)).toBeNull();
  });
});
