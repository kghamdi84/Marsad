/**
 * Investor figures (council batch 4, formula `investor-1`), from SEC XBRL facts as filed by `asOf` (no look-ahead):
 * free cash flow (operating cash flow minus capital spending), stock-based pay and its share of revenue, buybacks,
 * the change in diluted share count over a year (dilution), net cash, and with a price: market value, enterprise
 * value and its multiples. A figure the filings do not support is null and shown as not reported, never estimated.
 */
import type { FinancialFact } from './adapters/sec-facts.js';
import {
  annualValues,
  instantValues,
  pointInTime,
  preferConcepts,
  quarterlyValues,
  trailingFourQuarters,
  type Metric,
  type PeriodMetric,
} from './fundamentals.js';

export const INVESTOR_VERSION = 'investor-1';

/** Concepts batch 4 reads beyond `fundamentals-1`; the facts job stores them through STUDY_CONCEPTS. */
export const INVESTOR_CONCEPTS = [
  'PaymentsToAcquirePropertyPlantAndEquipment',
  'PaymentsToAcquireProductiveAssets',
  'ShareBasedCompensation',
  'PaymentsForRepurchaseOfCommonStock',
  'MarketableSecuritiesCurrent',
  'ShortTermInvestments',
  'AvailableForSaleSecuritiesDebtSecuritiesCurrent',
  'LongTermDebtNoncurrent',
  'LongTermDebtCurrent',
] as const;

const REVENUE = ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax'];
/** Capital spending: the plain tag first, then the broader one some filers use (NVIDIA after 2020). */
const CAPEX = ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'];
const SHORT_TERM = [
  'MarketableSecuritiesCurrent',
  'ShortTermInvestments',
  'AvailableForSaleSecuritiesDebtSecuritiesCurrent',
];
const NONE: Metric = { value: null, filed: null, accession: null, derived: false };

export interface InvestorView {
  asOf: string;
  formulaVersion: string;
  /** Trailing four quarters; each null unless four consecutive quarters were filed. */
  ttm: {
    revenue: Metric;
    operatingIncome: Metric;
    operatingCashFlow: Metric;
    capex: Metric;
    freeCashFlow: Metric;
    stockComp: Metric;
    buybacks: Metric;
  };
  /** Percentages (12.5 means 12.5%). */
  fcfMarginPct: number | null;
  stockCompPctRevenue: number | null;
  /** Diluted weighted shares in the newest quarter against the same quarter a year earlier, in percent. */
  dilutionYoYPct: number | null;
  balance: {
    end: string;
    cash: Metric;
    shortTermInvestments: Metric;
    debt: Metric;
    /** Cash plus short-term investments minus debt; negative is net debt. */
    netCash: number | null;
  } | null;
  sharesOutstanding: { end: string; metric: Metric } | null;
  /** Price times shares outstanding; null without a price or a share count. */
  marketValue: number | null;
  /** Market value plus debt minus cash and short-term investments. */
  enterpriseValue: number | null;
  evToSales: number | null;
  /** Null when trailing operating income is zero or negative (not meaningful). */
  evToEbit: number | null;
  /** Null when trailing free cash flow is zero or negative. */
  priceToFcf: number | null;
  /** Free cash flow over market value, in percent; negative when cash flow is. */
  fcfYieldPct: number | null;
  /** Up to ten fiscal years, newest last. */
  annual: { end: string; revenue: Metric; epsDiluted: Metric; freeCashFlow: Metric }[];
}

const days = (a: string) => Date.parse(`${a}T00:00:00Z`) / 86_400_000;

function difference(a: Metric, b: Metric): Metric {
  if (a.value === null || b.value === null) return NONE;
  const later = (a.filed ?? '') >= (b.filed ?? '') ? a : b;
  return {
    value: a.value - b.value,
    filed: later.filed,
    accession: later.accession,
    derived: true,
  };
}

const ratio = (num: number | null, den: number | null): number | null =>
  num === null || den === null || den <= 0 ? null : num / den;

/** What the filings said on `asOf`; `price` is the close used for market value (null leaves it out). */
export function investorView(
  all: readonly FinancialFact[],
  asOf: string,
  price: number | null,
): InvestorView {
  const facts = pointInTime(all, asOf);
  const usd = (c: readonly string[]) => preferConcepts(facts, c, 'USD');
  const ttm = (c: readonly string[]) => trailingFourQuarters(quarterlyValues(usd(c))) ?? NONE;
  const revenue = ttm(REVENUE);
  const operatingIncome = ttm(['OperatingIncomeLoss']);
  const ocf = ttm(['NetCashProvidedByUsedInOperatingActivities']);
  const capex = ttm(CAPEX);
  const fcf = difference(ocf, capex);
  const stockComp = ttm(['ShareBasedCompensation']);
  const buybacks = ttm(['PaymentsForRepurchaseOfCommonStock']);

  // Dilution: the newest quarter's diluted weighted shares against the quarter about a year before.
  const shares = quarterlyValues(
    preferConcepts(facts, ['WeightedAverageNumberOfDilutedSharesOutstanding'], 'shares'),
  ).filter((q) => !q.derived);
  const newest = shares.at(-1);
  const yearAgo = newest
    ? shares.find((q) => {
        const gap = days(newest.end) - days(q.end);
        return gap >= 350 && gap <= 380;
      })
    : undefined;
  const dilutionYoYPct =
    newest?.value != null && yearAgo?.value != null && yearAgo.value > 0
      ? (newest.value / yearAgo.value - 1) * 100
      : null;

  // The balance sheet at the newest date that reports cash.
  const cashList = instantValues(usd(['CashAndCashEquivalentsAtCarryingValue']));
  const end = cashList.at(-1)?.end;
  const at = (c: readonly string[]): Metric =>
    end ? (instantValues(usd(c)).find((x) => x.end === end)?.metric ?? NONE) : NONE;
  let balance: InvestorView['balance'] = null;
  if (end) {
    const cash = at(['CashAndCashEquivalentsAtCarryingValue']);
    const sti = at(SHORT_TERM);
    const total = at(['LongTermDebt']);
    const debt =
      total.value !== null
        ? total
        : (() => {
            const non = at(['LongTermDebtNoncurrent']);
            const cur = at(['LongTermDebtCurrent']);
            if (non.value === null && cur.value === null) return NONE;
            return {
              value: (non.value ?? 0) + (cur.value ?? 0),
              filed: (non.filed ?? '') >= (cur.filed ?? '') ? non.filed : cur.filed,
              accession: (non.filed ?? '') >= (cur.filed ?? '') ? non.accession : cur.accession,
              derived: true,
            };
          })();
    balance = {
      end,
      cash,
      shortTermInvestments: sti,
      debt,
      netCash:
        cash.value === null || debt.value === null
          ? null
          : cash.value + (sti.value ?? 0) - debt.value,
    };
  }

  const out = instantValues(
    preferConcepts(facts, ['EntityCommonStockSharesOutstanding'], 'shares'),
  ).at(-1);
  const sharesOutstanding = out ?? null;
  const marketValue =
    price !== null && price > 0 && sharesOutstanding?.metric.value
      ? price * sharesOutstanding.metric.value
      : null;
  const enterpriseValue =
    marketValue === null ||
    balance === null ||
    balance.cash.value === null ||
    balance.debt.value === null
      ? null
      : marketValue +
        balance.debt.value -
        balance.cash.value -
        (balance.shortTermInvestments.value ?? 0);

  const annualRevenue = annualValues(usd(REVENUE));
  const annualEps = annualValues(preferConcepts(facts, ['EarningsPerShareDiluted'], 'USD/shares'));
  const annualOcf = annualValues(usd(['NetCashProvidedByUsedInOperatingActivities']));
  const annualCapex = annualValues(usd(CAPEX));
  const pick = (l: readonly PeriodMetric[], e: string): Metric =>
    l.find((p) => p.end === e) ?? NONE;

  return {
    asOf,
    formulaVersion: INVESTOR_VERSION,
    ttm: {
      revenue,
      operatingIncome,
      operatingCashFlow: ocf,
      capex,
      freeCashFlow: fcf,
      stockComp,
      buybacks,
    },
    fcfMarginPct: pctOf(fcf.value, revenue.value),
    stockCompPctRevenue: pctOf(stockComp.value, revenue.value),
    dilutionYoYPct,
    balance,
    sharesOutstanding,
    marketValue,
    enterpriseValue,
    evToSales: ratio(enterpriseValue, revenue.value),
    evToEbit: ratio(enterpriseValue, operatingIncome.value),
    priceToFcf: ratio(marketValue, fcf.value),
    fcfYieldPct:
      marketValue === null || fcf.value === null ? null : (fcf.value / marketValue) * 100,
    annual: annualRevenue.slice(-10).map((r) => ({
      end: r.end,
      revenue: r,
      epsDiluted: pick(annualEps, r.end),
      freeCashFlow: difference(pick(annualOcf, r.end), pick(annualCapex, r.end)),
    })),
  };
}

function pctOf(num: number | null, den: number | null): number | null {
  return num === null || den === null || den <= 0 ? null : (num / den) * 100;
}
