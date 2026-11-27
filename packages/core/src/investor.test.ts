import { describe, expect, it } from 'vitest';
import type { FinancialFact } from './adapters/sec-facts.js';
import { STUDY_CONCEPTS } from './fundamentals.js';
import { INVESTOR_CONCEPTS, INVESTOR_VERSION, investorView } from './investor.js';

// A made-up company, every figure chosen so the answers can be checked by hand. All filed 2026-02-15.
const FILED = '2026-02-15';
const fact = (
  concept: string,
  start: string | null,
  end: string,
  value: number,
  unit = 'USD',
  taxonomy = 'us-gaap',
): FinancialFact => ({
  taxonomy,
  concept,
  unit,
  start,
  end,
  value,
  accession: '0000000000-26-000001',
  form: '10-K',
  fy: 2025,
  fp: 'FY',
  filed: FILED,
  frame: null,
});
const QUARTERS: [string, string][] = [
  ['2025-01-01', '2025-03-31'],
  ['2025-04-01', '2025-06-30'],
  ['2025-07-01', '2025-09-30'],
  ['2025-10-01', '2025-12-31'],
];
const each = (concept: string, v: number, unit = 'USD') =>
  QUARTERS.map(([s, e]) => fact(concept, s, e, v, unit));

const FACTS: FinancialFact[] = [
  // Per quarter: revenue 250, operating income 50, operating cash flow 75, capex 25, stock pay 10, buybacks 20.
  ...each('Revenues', 250),
  ...each('OperatingIncomeLoss', 50),
  ...each('NetCashProvidedByUsedInOperatingActivities', 75),
  ...each('PaymentsToAcquirePropertyPlantAndEquipment', 25),
  ...each('ShareBasedCompensation', 10),
  ...each('PaymentsForRepurchaseOfCommonStock', 20),
  // Diluted weighted shares: 100 a year earlier, 105 now (+5%).
  fact(
    'WeightedAverageNumberOfDilutedSharesOutstanding',
    '2024-10-01',
    '2024-12-31',
    100,
    'shares',
  ),
  fact(
    'WeightedAverageNumberOfDilutedSharesOutstanding',
    '2025-10-01',
    '2025-12-31',
    105,
    'shares',
  ),
  // Balance at 2025-12-31: cash 300, marketable securities 200, debt 400 long term plus 100 current.
  fact('CashAndCashEquivalentsAtCarryingValue', null, '2025-12-31', 300),
  fact('MarketableSecuritiesCurrent', null, '2025-12-31', 200),
  fact('LongTermDebtNoncurrent', null, '2025-12-31', 400),
  fact('LongTermDebtCurrent', null, '2025-12-31', 100),
  // 100 shares outstanding on the cover page.
  fact('EntityCommonStockSharesOutstanding', null, '2026-01-31', 100, 'shares', 'dei'),
  // Twelve fiscal years of revenue (100, 200, ... 1,200); the last year also has cash flow and EPS.
  ...Array.from({ length: 12 }, (_, i) =>
    fact('Revenues', `${2014 + i}-01-01`, `${2014 + i}-12-31`, 100 * (i + 1)),
  ),
  fact('NetCashProvidedByUsedInOperatingActivities', '2025-01-01', '2025-12-31', 300),
  fact('PaymentsToAcquirePropertyPlantAndEquipment', '2025-01-01', '2025-12-31', 100),
  fact('EarningsPerShareDiluted', '2025-01-01', '2025-12-31', 2, 'USD/shares'),
];

describe('investorView, hand-checked (investor-1)', () => {
  const v = investorView(FACTS, '2026-03-01', 20);

  it('free cash flow, stock pay and buybacks over the trailing four quarters', () => {
    expect(v.ttm.revenue.value).toBe(1000);
    expect(v.ttm.freeCashFlow.value).toBe(200); // 300 - 100
    expect(v.ttm.freeCashFlow.derived).toBe(true);
    expect(v.fcfMarginPct).toBeCloseTo(20, 12);
    expect(v.ttm.stockComp.value).toBe(40);
    expect(v.stockCompPctRevenue).toBeCloseTo(4, 12);
    expect(v.ttm.buybacks.value).toBe(80);
  });

  it('dilution: diluted shares against the same quarter a year earlier', () => {
    expect(v.dilutionYoYPct).toBeCloseTo(5, 12);
  });

  it('net cash: cash plus short-term investments minus both parts of debt', () => {
    expect(v.balance?.debt.value).toBe(500);
    expect(v.balance?.netCash).toBe(0); // 300 + 200 - 500
  });

  it('market value, enterprise value and multiples at a price of 20', () => {
    expect(v.marketValue).toBe(2000); // 20 x 100 shares
    expect(v.enterpriseValue).toBe(2000); // 2,000 + 500 - 300 - 200
    expect(v.evToSales).toBeCloseTo(2, 12); // 2,000 / 1,000
    expect(v.evToEbit).toBeCloseTo(10, 12); // 2,000 / 200
    expect(v.priceToFcf).toBeCloseTo(10, 12); // 2,000 / 200
    expect(v.fcfYieldPct).toBeCloseTo(10, 12); // 200 / 2,000
  });

  it('ten fiscal years at most, newest last, with free cash flow where both parts exist', () => {
    expect(v.annual).toHaveLength(10);
    expect(v.annual[0]?.end).toBe('2016-12-31');
    expect(v.annual.at(-1)).toMatchObject({
      end: '2025-12-31',
      revenue: { value: 1200 },
      epsDiluted: { value: 2 },
      freeCashFlow: { value: 200 },
    });
    expect(v.annual[0]?.freeCashFlow.value).toBeNull();
  });

  it('uses nothing filed after the as-of date, and nothing without a price', () => {
    const before = investorView(FACTS, '2026-02-14', 20);
    expect(before.ttm.revenue.value).toBeNull();
    expect(before.marketValue).toBeNull();
    expect(investorView(FACTS, '2026-03-01', null).marketValue).toBeNull();
    expect(v.formulaVersion).toBe(INVESTOR_VERSION);
  });

  it('negative operating income or cash flow gives no multiple, never a negative one', () => {
    const loss = FACTS.map((f) =>
      f.concept === 'OperatingIncomeLoss' ||
      f.concept === 'NetCashProvidedByUsedInOperatingActivities'
        ? { ...f, value: -Math.abs(f.value) }
        : f,
    );
    const l = investorView(loss, '2026-03-01', 20);
    expect(l.evToEbit).toBeNull();
    expect(l.priceToFcf).toBeNull();
    expect(l.fcfYieldPct).toBeLessThan(0);
  });

  it('the facts job stores every concept this reads', () => {
    for (const c of INVESTOR_CONCEPTS) expect(STUDY_CONCEPTS['us-gaap']).toContain(c);
  });
});
