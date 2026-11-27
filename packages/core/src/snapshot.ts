/**
 * The Study page snapshot (formula `snapshot-1`): market value, revenue over the last four quarters with its change
 * on the four quarters a year earlier, and net margin over the same four quarters. Everything comes from SEC XBRL
 * facts as filed by `asOf` (no look-ahead); a figure the filings do not support is null, never estimated.
 */
import type { FinancialFact } from './adapters/sec-facts.js';
import {
  pointInTime,
  preferConcepts,
  quarterlyValues,
  trailingFourQuarters,
  type Metric,
  type PeriodMetric,
} from './fundamentals.js';
import { investorView } from './investor.js';

export const SNAPSHOT_VERSION = 'snapshot-1';

const REVENUE = ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax'];
const DAY = 86_400_000;
const days = (d: string) => Date.parse(`${d}T00:00:00Z`) / DAY;

export interface CompanySnapshot {
  asOf: string;
  formulaVersion: string;
  /** Price times the shares on the newest cover page; null without either. */
  marketValue: number | null;
  sharesOutstanding: { end: string; value: number } | null;
  /** Revenue over the newest four consecutive quarters, and the end of the newest one. */
  revenueTtm: Metric | null;
  revenueTtmEnd: string | null;
  /** Change on the four consecutive quarters ending 350 to 380 days earlier, in percent (12.5 means 12.5%). */
  revenueTtmYoYPct: number | null;
  /** Net income over revenue for the same four quarters, in percent; null when revenue is zero or negative. */
  netMarginTtmPct: number | null;
}

function ttm(q: readonly PeriodMetric[]): { metric: Metric; end: string } | null {
  const m = trailingFourQuarters(q);
  const end = q.at(-1)?.end;
  return m && end ? { metric: m, end } : null;
}

export function companySnapshot(
  all: readonly FinancialFact[],
  asOf: string,
  price: number | null,
): CompanySnapshot {
  const facts = pointInTime(all, asOf);
  const revenueQ = quarterlyValues(preferConcepts(facts, REVENUE, 'USD'));
  const incomeQ = quarterlyValues(preferConcepts(facts, ['NetIncomeLoss'], 'USD'));
  const now = ttm(revenueQ);

  let yoy: number | null = null;
  if (now?.metric.value != null) {
    const earlier = revenueQ.filter((p) => days(now.end) - days(p.end) >= 350);
    const prior = ttm(earlier);
    const gap = prior ? days(now.end) - days(prior.end) : 0;
    if (prior?.metric.value != null && prior.metric.value > 0 && gap <= 380)
      yoy = (now.metric.value / prior.metric.value - 1) * 100;
  }

  // Net income over the very same four quarters as revenue, or no margin at all.
  let margin: number | null = null;
  if (now?.metric.value != null && now.metric.value > 0) {
    const income = ttm(incomeQ.filter((p) => p.end <= now.end));
    if (income?.end === now.end && income.metric.value !== null)
      margin = (income.metric.value / now.metric.value) * 100;
  }

  const inv = investorView(all, asOf, price);
  const shares = inv.sharesOutstanding;
  return {
    asOf,
    formulaVersion: SNAPSHOT_VERSION,
    marketValue: inv.marketValue,
    sharesOutstanding:
      shares && shares.metric.value !== null
        ? { end: shares.end, value: shares.metric.value }
        : null,
    revenueTtm: now?.metric ?? null,
    revenueTtmEnd: now?.end ?? null,
    revenueTtmYoYPct: yoy,
    netMarginTtmPct: margin,
  };
}
