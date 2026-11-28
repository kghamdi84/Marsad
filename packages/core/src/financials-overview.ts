/**
 * Financial statements overview (`financials-overview-1`): one column per fiscal year (Annual), the trailing four
 * quarters (TTM) or each quarter (Quarterly), from SEC XBRL facts as filed by `asOf` (no look-ahead).
 *
 * Income: revenue, gross profit, operating income, EBITDA (operating income plus depreciation and amortization,
 * only when depreciation is tagged for the same period), net income.
 * Balance (at the column's end date): cash and short-term investments (short-term investments counted where
 * tagged, as in investor-1), total assets, total debt (long-term debt, or its noncurrent plus current parts), net
 * debt (debt minus cash and short-term investments), total liabilities, stockholders' equity.
 * Cash flow: operating, investing and financing cash flow, and free cash flow (operating cash flow minus capital
 * spending).
 *
 * A line the filings do not support is null, never estimated. Quarterly flows may be derived from year-to-date
 * totals (fundamentals-1); a column with any derived figure says so.
 */
import type { FinancialFact } from './adapters/sec-facts.js';
import {
  annualValues,
  instantValues,
  pointInTime,
  preferConcepts,
  quarterlyValues,
  trailingFourQuarters,
  type PeriodMetric,
} from './fundamentals.js';

export const FINANCIALS_OVERVIEW_VERSION = 'financials-overview-1';

/** Concepts read beyond investor-1; the facts job stores them through STUDY_CONCEPTS. */
export const OVERVIEW_CONCEPTS = [
  'DepreciationDepletionAndAmortization',
  'DepreciationAndAmortization',
  'NetCashProvidedByUsedInInvestingActivities',
  'NetCashProvidedByUsedInFinancingActivities',
] as const;

export const OVERVIEW_LINES = [
  'revenue',
  'grossProfit',
  'operatingIncome',
  'ebitda',
  'netIncome',
  'cashAndSti',
  'totalAssets',
  'totalDebt',
  'netDebt',
  'totalLiabilities',
  'equity',
  'operatingCashFlow',
  'investingCashFlow',
  'financingCashFlow',
  'freeCashFlow',
] as const;
export type OverviewLine = (typeof OVERVIEW_LINES)[number];
export type OverviewMode = 'annual' | 'ttm' | 'quarterly';

export interface OverviewColumn {
  /** The period end (for TTM, the newest quarter's end). */
  end: string;
  start: string | null;
  values: Record<OverviewLine, number | null>;
  /** True when a flow figure in the column was derived from year-to-date totals. */
  derived: boolean;
  /** The newest filing date among the column's figures. */
  filed: string | null;
}

export interface FinancialsOverview {
  formulaVersion: string;
  asOf: string;
  mode: OverviewMode;
  /** Oldest first. */
  columns: OverviewColumn[];
}

const REVENUE = ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax'];
const CAPEX = ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'];
const SHORT_TERM = [
  'MarketableSecuritiesCurrent',
  'ShortTermInvestments',
  'AvailableForSaleSecuritiesDebtSecuritiesCurrent',
];
const DA = ['DepreciationDepletionAndAmortization', 'DepreciationAndAmortization'];

type Flow = 'revenue' | 'gp' | 'oi' | 'da' | 'ni' | 'cfo' | 'cfi' | 'cff' | 'capex';
const FLOWS: Record<Flow, readonly string[]> = {
  revenue: REVENUE,
  gp: ['GrossProfit'],
  oi: ['OperatingIncomeLoss'],
  da: DA,
  ni: ['NetIncomeLoss'],
  cfo: ['NetCashProvidedByUsedInOperatingActivities'],
  cfi: ['NetCashProvidedByUsedInInvestingActivities'],
  cff: ['NetCashProvidedByUsedInFinancingActivities'],
  capex: CAPEX,
};

interface Fig {
  value: number | null;
  filed: string | null;
  derived: boolean;
}
const NONE: Fig = { value: null, filed: null, derived: false };

export function financialsOverview(
  all: readonly FinancialFact[],
  asOf: string,
  mode: OverviewMode,
  count = mode === 'quarterly' ? 8 : 5,
): FinancialsOverview {
  const facts = pointInTime(all, asOf);
  const usd = (c: readonly string[]) => preferConcepts(facts, c, 'USD');
  const series = {} as Record<Flow, PeriodMetric[]>;
  for (const k of Object.keys(FLOWS) as Flow[])
    series[k] = mode === 'annual' ? annualValues(usd(FLOWS[k])) : quarterlyValues(usd(FLOWS[k]));

  const inst = (c: readonly string[]) =>
    new Map(instantValues(usd(c)).map((x) => [x.end, x.metric]));
  const cash = inst(['CashAndCashEquivalentsAtCarryingValue']);
  const sti = inst(SHORT_TERM);
  const assets = inst(['Assets']);
  const liabilities = inst(['Liabilities']);
  const equity = inst(['StockholdersEquity']);
  const ltd = inst(['LongTermDebt']);
  const ltdNon = inst(['LongTermDebtNoncurrent']);
  const ltdCur = inst(['LongTermDebtCurrent']);

  // The columns follow revenue, else net income: a period with neither has nothing to show.
  const anchor = series.revenue.length > 0 ? series.revenue : series.ni;
  const ends =
    mode === 'ttm'
      ? anchor.length >= 4
        ? [anchor.at(-1) as PeriodMetric]
        : []
      : anchor.slice(-count);

  const flowAt = (k: Flow, end: string): Fig => {
    if (mode === 'ttm') {
      const upto = series[k].filter((p) => p.end <= end);
      if (upto.at(-1)?.end !== end) return NONE;
      const m = trailingFourQuarters(upto);
      return m ? { value: m.value, filed: m.filed, derived: m.derived } : NONE;
    }
    const p = series[k].find((x) => x.end === end);
    return p ? { value: p.value, filed: p.filed, derived: p.derived } : NONE;
  };
  const instAt = (
    m: Map<string, { value: number | null; filed: string | null }>,
    end: string,
  ): Fig => {
    const x = m.get(end);
    return x ? { value: x.value, filed: x.filed, derived: false } : NONE;
  };

  const columns: OverviewColumn[] = ends.map((p) => {
    const f = {} as Record<Flow, Fig>;
    for (const k of Object.keys(FLOWS) as Flow[]) f[k] = flowAt(k, p.end);
    const c = instAt(cash, p.end);
    const s = instAt(sti, p.end);
    const total = instAt(ltd, p.end);
    const non = instAt(ltdNon, p.end);
    const cur = instAt(ltdCur, p.end);
    const debt =
      total.value !== null
        ? total.value
        : non.value === null && cur.value === null
          ? null
          : (non.value ?? 0) + (cur.value ?? 0);
    const cashSti = c.value === null ? null : c.value + (s.value ?? 0);
    const add = (a: number | null, b: number | null) => (a === null || b === null ? null : a + b);
    const sub = (a: number | null, b: number | null) => (a === null || b === null ? null : a - b);
    const a = instAt(assets, p.end);
    const l = instAt(liabilities, p.end);
    const e = instAt(equity, p.end);
    const values: Record<OverviewLine, number | null> = {
      revenue: f.revenue.value,
      grossProfit: f.gp.value,
      operatingIncome: f.oi.value,
      ebitda: add(f.oi.value, f.da.value),
      netIncome: f.ni.value,
      cashAndSti: cashSti,
      totalAssets: a.value,
      totalDebt: debt,
      netDebt: sub(debt, cashSti),
      totalLiabilities: l.value,
      equity: e.value,
      operatingCashFlow: f.cfo.value,
      investingCashFlow: f.cfi.value,
      financingCashFlow: f.cff.value,
      freeCashFlow: sub(f.cfo.value, f.capex.value),
    };
    const figs = [...Object.values(f), c, s, total, non, cur, a, l, e];
    let filed: string | null = null;
    for (const x of figs)
      if (x.value !== null && x.filed && (!filed || x.filed > filed)) filed = x.filed;
    return {
      end: p.end,
      start: mode === 'ttm' ? null : p.start,
      values,
      derived: Object.values(f).some((x) => x.value !== null && x.derived),
      filed,
    };
  });
  return { formulaVersion: FINANCIALS_OVERVIEW_VERSION, asOf, mode, columns };
}

/** Net income over revenue in percent, and total liabilities over total assets in percent, per column. */
export function overviewRatios(col: OverviewColumn): {
  profitMarginPct: number | null;
  liabilitiesToAssetsPct: number | null;
} {
  const v = col.values;
  return {
    profitMarginPct:
      v.netIncome === null || v.revenue === null || v.revenue <= 0
        ? null
        : (v.netIncome / v.revenue) * 100,
    liabilitiesToAssetsPct:
      v.totalLiabilities === null || v.totalAssets === null || v.totalAssets <= 0
        ? null
        : (v.totalLiabilities / v.totalAssets) * 100,
  };
}
