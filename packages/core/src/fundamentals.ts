/**
 * Financial statements as they were known on a date. Built on SEC XBRL company facts, where each value carries
 * the filing that reported it.
 *
 * Point-in-time rules (integrity rule 9): a value is available from the date its filing was filed, never
 * earlier; when a period was reported more than once, the latest filing on or before the date wins (a
 * restatement replaces it only from the day the restating filing appeared).
 *
 * Quarters: a 10-Q gives 3-month figures for the first three quarters and year-to-date totals; the 10-K gives
 * only the full year. A missing quarter is derived by subtracting year-to-date totals (Q2 = 6 months minus Q1,
 * Q3 = 9 months minus 6 months, Q4 = year minus 9 months) and is marked `derived`. Cash-flow figures exist only
 * as year-to-date totals, so every quarter of them is derived. Periods are identified by their dates: `fy` and
 * `fp` describe the filing, so a comparison figure repeated in next year's 10-Q carries next year's labels.
 */
import type { FinancialFact } from './adapters/sec-facts.js';

export const FUNDAMENTALS_VERSION = 'fundamentals-1';

/** The XBRL concepts the Study page reads. The job stores only these, so a company's thousands of tags stay out. */
export const STUDY_CONCEPTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'us-gaap': [
    'Revenues',
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'GrossProfit',
    'OperatingIncomeLoss',
    'NetIncomeLoss',
    'EarningsPerShareDiluted',
    'WeightedAverageNumberOfDilutedSharesOutstanding',
    'Assets',
    'Liabilities',
    'StockholdersEquity',
    'CashAndCashEquivalentsAtCarryingValue',
    'LongTermDebt',
    'NetCashProvidedByUsedInOperatingActivities',
  ],
  dei: ['EntityCommonStockSharesOutstanding'],
});

const DAY = 86_400_000;
const days = (a: string) => Date.parse(`${a}T00:00:00Z`) / DAY;
/** Length of a period in days, counting both ends. */
export const periodDays = (start: string, end: string): number => days(end) - days(start) + 1;

export interface Metric {
  value: number | null;
  /** The filing date the figure became public; for a derived figure, the latest of its parts. */
  filed: string | null;
  /** The accession number of that filing (the latest one for a derived figure). */
  accession: string | null;
  derived: boolean;
}

const NONE: Metric = { value: null, filed: null, accession: null, derived: false };

/** The latest filing on or before `asOf` for every (concept, unit, period). */
export function pointInTime(facts: readonly FinancialFact[], asOf: string): FinancialFact[] {
  const best = new Map<string, FinancialFact>();
  for (const f of facts) {
    if (f.filed > asOf) continue;
    const key = `${f.taxonomy}|${f.concept}|${f.unit}|${f.start ?? ''}|${f.end}`;
    const cur = best.get(key);
    if (!cur || f.filed > cur.filed || (f.filed === cur.filed && f.accession > cur.accession))
      best.set(key, f);
  }
  return [...best.values()];
}

/**
 * Facts for the first concept in `concepts` that has the period, falling back down the list period by period
 * (revenue is `Revenues` in recent filings and a different tag in older ones).
 */
export function preferConcepts(
  facts: readonly FinancialFact[],
  concepts: readonly string[],
  unit: string,
): FinancialFact[] {
  const out: FinancialFact[] = [];
  const taken = new Set<string>();
  for (const concept of concepts) {
    const mine = facts.filter((f) => f.concept === concept && f.unit === unit);
    const keys = new Set(mine.map((f) => `${f.start ?? ''}|${f.end}`));
    for (const f of mine) if (!taken.has(`${f.start ?? ''}|${f.end}`)) out.push(f);
    for (const k of keys) taken.add(k);
  }
  return out;
}

type Span = 'q' | 'h1' | 'm9' | 'fy';
function span(f: FinancialFact): Span | null {
  if (f.start === null) return null;
  const d = periodDays(f.start, f.end);
  if (d >= 80 && d <= 100) return 'q';
  if (d >= 170 && d <= 195) return 'h1';
  if (d >= 260 && d <= 285) return 'm9';
  if (d >= 350 && d <= 380) return 'fy';
  return null;
}

const metric = (f: FinancialFact): Metric => ({
  value: f.value,
  filed: f.filed,
  accession: f.accession,
  derived: false,
});
const later = (a: FinancialFact, b: FinancialFact) => (a.filed >= b.filed ? a : b);

export interface PeriodMetric extends Metric {
  start: string;
  end: string;
}

/** Whole fiscal years (about 12 months), newest last, one per end date. */
export function annualValues(facts: readonly FinancialFact[]): PeriodMetric[] {
  return facts
    .filter((f) => span(f) === 'fy')
    .map((f) => ({ ...metric(f), start: f.start as string, end: f.end }))
    .sort((a, b) => a.end.localeCompare(b.end));
}

/** One value per fiscal quarter, newest last, direct where a 3-month figure exists and derived otherwise. */
export function quarterlyValues(facts: readonly FinancialFact[]): PeriodMetric[] {
  const out = new Map<string, PeriodMetric>();
  for (const f of facts)
    if (span(f) === 'q') out.set(f.end, { ...metric(f), start: f.start as string, end: f.end });
  // Group the year-to-date rows by the start of their fiscal year.
  const byStart = new Map<string, Partial<Record<Span, FinancialFact>>>();
  for (const f of facts) {
    const s = span(f);
    if (s === null) continue;
    const row = byStart.get(f.start as string) ?? {};
    row[s] = f;
    byStart.set(f.start as string, row);
  }
  for (const [start, r] of byStart) {
    const derive = (
      cur: FinancialFact | undefined,
      prev: FinancialFact | undefined,
      prevEnd: string,
    ) => {
      if (!cur || !prev || out.has(cur.end)) return;
      const startNext = new Date(days(prevEnd) * DAY + DAY).toISOString().slice(0, 10);
      const l = later(cur, prev);
      out.set(cur.end, {
        value: cur.value - prev.value,
        filed: l.filed,
        accession: l.accession,
        derived: true,
        start: startNext,
        end: cur.end,
      });
    };
    // The first quarter of the year is the 3-month row with the same start as the year, when it exists.
    const q1 = r.q;
    derive(r.h1, q1, q1?.end ?? start);
    derive(r.m9, r.h1, r.h1?.end ?? start);
    derive(r.fy, r.m9, r.m9?.end ?? start);
  }
  return [...out.values()].sort((a, b) => a.end.localeCompare(b.end));
}

/** Balance-sheet values at a date, newest last. */
export function instantValues(facts: readonly FinancialFact[]): { end: string; metric: Metric }[] {
  return facts
    .filter((f) => f.start === null)
    .map((f) => ({ end: f.end, metric: metric(f) }))
    .sort((a, b) => a.end.localeCompare(b.end));
}

/** Sum of the newest four quarters, or null unless they are four consecutive quarters. */
export function trailingFourQuarters(q: readonly PeriodMetric[]): Metric | null {
  const last4 = q.slice(-4);
  if (last4.length < 4) return null;
  for (let i = 1; i < 4; i += 1) {
    const gap = days((last4[i] as PeriodMetric).end) - days((last4[i - 1] as PeriodMetric).end);
    if (gap < 80 || gap > 100) return null;
  }
  let sum = 0;
  let filed = '';
  let accession = '';
  for (const p of last4) {
    if (p.value === null) return null;
    sum += p.value;
    if (p.filed && p.filed >= filed) {
      filed = p.filed;
      accession = p.accession ?? '';
    }
  }
  return { value: sum, filed, accession, derived: last4.some((p) => p.derived) };
}

const pct = (num: number | null, den: number | null): number | null =>
  num === null || den === null || den <= 0 ? null : (num / den) * 100;

export interface QuarterRow {
  end: string;
  revenue: Metric;
  grossProfit: Metric;
  operatingIncome: Metric;
  netIncome: Metric;
  epsDiluted: Metric;
  grossMarginPct: number | null;
  operatingMarginPct: number | null;
  netMarginPct: number | null;
  /** Change from the same quarter a year earlier, in percent. Null when that quarter or its revenue is missing. */
  revenueYoYPct: number | null;
}

export interface FinancialSummary {
  asOf: string;
  formulaVersion: string;
  /** The newest quarter with revenue, and the filing it was reported in. */
  latest: { end: string; filed: string } | null;
  quarters: QuarterRow[];
  annual: { end: string; revenue: Metric; netIncome: Metric; epsDiluted: Metric }[];
  ttm: {
    revenue: Metric;
    grossProfit: Metric;
    operatingIncome: Metric;
    netIncome: Metric;
    epsDiluted: Metric;
    operatingCashFlow: Metric;
  } | null;
  balance: {
    end: string;
    assets: Metric;
    liabilities: Metric;
    equity: Metric;
    cash: Metric;
    longTermDebt: Metric;
  } | null;
}

const REVENUE = ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax'];

/** What the filings said on `asOf` (a YYYY-MM-DD date): nothing filed after it is used. */
export function summarizeFinancials(
  all: readonly FinancialFact[],
  asOf: string,
  quarterCount = 8,
): FinancialSummary {
  const facts = pointInTime(all, asOf);
  const usd = (concepts: readonly string[]) => preferConcepts(facts, concepts, 'USD');
  const q = {
    revenue: quarterlyValues(usd(REVENUE)),
    grossProfit: quarterlyValues(usd(['GrossProfit'])),
    operatingIncome: quarterlyValues(usd(['OperatingIncomeLoss'])),
    netIncome: quarterlyValues(usd(['NetIncomeLoss'])),
    eps: quarterlyValues(preferConcepts(facts, ['EarningsPerShareDiluted'], 'USD/shares')),
    ocf: quarterlyValues(usd(['NetCashProvidedByUsedInOperatingActivities'])),
  };
  const at = (list: readonly PeriodMetric[], end: string): Metric =>
    list.find((p) => p.end === end) ?? NONE;
  const rows: QuarterRow[] = q.revenue.slice(-quarterCount).map((r) => {
    const gp = at(q.grossProfit, r.end);
    const oi = at(q.operatingIncome, r.end);
    const ni = at(q.netIncome, r.end);
    const yearAgo = q.revenue.find((p) => {
      const gap = days(r.end) - days(p.end);
      return gap >= 350 && gap <= 380;
    });
    return {
      end: r.end,
      revenue: r,
      grossProfit: gp,
      operatingIncome: oi,
      netIncome: ni,
      epsDiluted: at(q.eps, r.end),
      grossMarginPct: pct(gp.value, r.value),
      operatingMarginPct: pct(oi.value, r.value),
      netMarginPct: pct(ni.value, r.value),
      revenueYoYPct:
        yearAgo && yearAgo.value !== null && yearAgo.value > 0 && r.value !== null
          ? ((r.value - yearAgo.value) / yearAgo.value) * 100
          : null,
    };
  });
  const annualRev = annualValues(usd(REVENUE));
  const annualNi = annualValues(usd(['NetIncomeLoss']));
  const annualEps = annualValues(preferConcepts(facts, ['EarningsPerShareDiluted'], 'USD/shares'));
  const pick = (l: readonly PeriodMetric[], end: string): Metric =>
    l.find((p) => p.end === end) ?? NONE;

  const ttm = (list: readonly PeriodMetric[]) => trailingFourQuarters(list) ?? NONE;
  const revenueTtm = trailingFourQuarters(q.revenue);
  const latestQuarter = q.revenue.at(-1);
  const bal = (concept: string) => instantValues(preferConcepts(facts, [concept], 'USD'));
  const assets = bal('Assets');
  const lastEnd = assets.at(-1)?.end;
  const balAt = (list: ReturnType<typeof bal>): Metric =>
    list.find((x) => x.end === lastEnd)?.metric ?? NONE;

  return {
    asOf,
    formulaVersion: FUNDAMENTALS_VERSION,
    latest:
      latestQuarter && latestQuarter.filed
        ? { end: latestQuarter.end, filed: latestQuarter.filed }
        : null,
    quarters: rows,
    annual: annualRev.slice(-5).map((r) => ({
      end: r.end,
      revenue: r,
      netIncome: pick(annualNi, r.end),
      epsDiluted: pick(annualEps, r.end),
    })),
    ttm: revenueTtm
      ? {
          revenue: revenueTtm,
          grossProfit: ttm(q.grossProfit),
          operatingIncome: ttm(q.operatingIncome),
          netIncome: ttm(q.netIncome),
          epsDiluted: ttm(q.eps),
          operatingCashFlow: ttm(q.ocf),
        }
      : null,
    balance: lastEnd
      ? {
          end: lastEnd,
          assets: balAt(assets),
          liabilities: balAt(bal('Liabilities')),
          equity: balAt(bal('StockholdersEquity')),
          cash: balAt(bal('CashAndCashEquivalentsAtCarryingValue')),
          longTermDebt: balAt(bal('LongTermDebt')),
        }
      : null,
  };
}

/** Price divided by trailing diluted earnings per share. Null when earnings are zero or negative (not meaningful). */
export function peRatio(price: number, epsTtm: number | null): number | null {
  return epsTtm === null || epsTtm <= 0 || !(price > 0) ? null : price / epsTtm;
}
