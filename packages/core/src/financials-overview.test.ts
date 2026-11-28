import { describe, expect, it } from 'vitest';
import type { FinancialFact } from './adapters/sec-facts.js';
import {
  FINANCIALS_OVERVIEW_VERSION,
  OVERVIEW_CONCEPTS,
  financialsOverview,
  overviewRatios,
} from './financials-overview.js';
import { STUDY_CONCEPTS } from './fundamentals.js';

const FILED = '2026-02-15';
const fact = (
  concept: string,
  start: string | null,
  end: string,
  value: number,
): FinancialFact => ({
  taxonomy: 'us-gaap',
  concept,
  unit: 'USD',
  start,
  end,
  value,
  accession: '0000000000-26-000001',
  form: start === null ? '10-K' : '10-Q',
  fy: null,
  fp: null,
  filed: FILED,
  frame: null,
});
const Q: [string, string][] = [
  ['2025-01-01', '2025-03-31'],
  ['2025-04-01', '2025-06-30'],
  ['2025-07-01', '2025-09-30'],
  ['2025-10-01', '2025-12-31'],
];
const quarterly = (c: string, v: number) => Q.map(([s, e]) => fact(c, s, e, v));
const END = '2025-12-31';

// A made-up company: per quarter revenue 250, gross profit 100, operating income 50, depreciation 10, net
// income 40, operating cash flow 60, capex 15, investing -20, financing -30. The full year is four times that.
const FACTS: FinancialFact[] = [
  ...quarterly('Revenues', 250),
  ...quarterly('GrossProfit', 100),
  ...quarterly('OperatingIncomeLoss', 50),
  ...quarterly('DepreciationDepletionAndAmortization', 10),
  ...quarterly('NetIncomeLoss', 40),
  ...quarterly('NetCashProvidedByUsedInOperatingActivities', 60),
  ...quarterly('PaymentsToAcquirePropertyPlantAndEquipment', 15),
  ...quarterly('NetCashProvidedByUsedInInvestingActivities', -20),
  ...quarterly('NetCashProvidedByUsedInFinancingActivities', -30),
  fact('Revenues', '2025-01-01', END, 1000),
  fact('GrossProfit', '2025-01-01', END, 400),
  fact('OperatingIncomeLoss', '2025-01-01', END, 200),
  fact('DepreciationDepletionAndAmortization', '2025-01-01', END, 40),
  fact('NetIncomeLoss', '2025-01-01', END, 160),
  fact('NetCashProvidedByUsedInOperatingActivities', '2025-01-01', END, 240),
  fact('PaymentsToAcquirePropertyPlantAndEquipment', '2025-01-01', END, 60),
  fact('NetCashProvidedByUsedInInvestingActivities', '2025-01-01', END, -80),
  fact('NetCashProvidedByUsedInFinancingActivities', '2025-01-01', END, -120),
  // Balance at the year end: cash 300, short-term investments 100, assets 2,000, liabilities 800,
  // equity 1,200, long-term debt in parts 250 noncurrent plus 50 current.
  fact('CashAndCashEquivalentsAtCarryingValue', null, END, 300),
  fact('MarketableSecuritiesCurrent', null, END, 100),
  fact('Assets', null, END, 2000),
  fact('Liabilities', null, END, 800),
  fact('StockholdersEquity', null, END, 1200),
  fact('LongTermDebtNoncurrent', null, END, 250),
  fact('LongTermDebtCurrent', null, END, 50),
];

describe('financials-overview-1', () => {
  it('builds the annual column by hand', () => {
    const o = financialsOverview(FACTS, '2026-03-01', 'annual');
    expect(o.formulaVersion).toBe(FINANCIALS_OVERVIEW_VERSION);
    expect(o.columns).toHaveLength(1);
    const c = o.columns[0];
    expect(c?.end).toBe(END);
    expect(c?.values).toEqual({
      revenue: 1000,
      grossProfit: 400,
      operatingIncome: 200,
      ebitda: 240,
      netIncome: 160,
      cashAndSti: 400,
      totalAssets: 2000,
      totalDebt: 300,
      netDebt: -100,
      totalLiabilities: 800,
      equity: 1200,
      operatingCashFlow: 240,
      investingCashFlow: -80,
      financingCashFlow: -120,
      freeCashFlow: 180,
    });
    expect(c?.derived).toBe(false);
    expect(c?.filed).toBe(FILED);
    // Net margin 160 / 1,000 = 16%; liabilities to assets 800 / 2,000 = 40%.
    expect(c && overviewRatios(c)).toEqual({ profitMarginPct: 16, liabilitiesToAssetsPct: 40 });
  });

  it('sums four quarters for TTM and lists quarters on their own', () => {
    const ttm = financialsOverview(FACTS, '2026-03-01', 'ttm');
    expect(ttm.columns[0]?.values.revenue).toBe(1000);
    expect(ttm.columns[0]?.values.freeCashFlow).toBe(180);
    expect(ttm.columns[0]?.values.totalAssets).toBe(2000);
    const q = financialsOverview(FACTS, '2026-03-01', 'quarterly');
    expect(q.columns.map((x) => x.end)).toEqual(Q.map(([, e]) => e));
    expect(q.columns[0]?.values.ebitda).toBe(60);
    // No balance sheet at the first quarter end: those lines are not available.
    expect(q.columns[0]?.values.totalAssets).toBeNull();
  });

  it('leaves EBITDA out without depreciation and uses nothing filed after the date', () => {
    const noDa = FACTS.filter((f) => f.concept !== 'DepreciationDepletionAndAmortization');
    expect(financialsOverview(noDa, '2026-03-01', 'annual').columns[0]?.values.ebitda).toBeNull();
    expect(financialsOverview(FACTS, '2026-02-14', 'annual').columns).toEqual([]);
  });

  it('reads only concepts the facts job stores', () => {
    for (const c of OVERVIEW_CONCEPTS) expect(STUDY_CONCEPTS['us-gaap']).toContain(c);
  });
});
