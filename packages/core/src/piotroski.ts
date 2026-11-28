/**
 * Piotroski F-score (`piotroski-1`): nine pass or fail tests on the two newest whole fiscal years in the SEC XBRL
 * facts known on a date (point in time, integrity rule 9). Piotroski (2000), "Value Investing: The Use of
 * Historical Financial Statement Information to Separate Winners from Losers".
 *
 * Year t is the newest fiscal year with net income; year t-1 is the fiscal year that ends 350 to 380 days earlier.
 * Balance-sheet values are read at the year ends: E(t), E(t-1) (the day before year t starts) and E(t-2) (the day
 * before year t-1 starts).
 *
 * Profitability (4)
 * 1. roa-positive: ROA(t) = net income(t) / total assets at E(t-1) is above 0.
 * 2. cfo-positive: operating cash flow(t) is above 0.
 * 3. roa-up: ROA(t) is above ROA(t-1) = net income(t-1) / total assets at E(t-2).
 * 4. accruals: operating cash flow(t) / total assets at E(t-1) is above ROA(t).
 * Leverage and liquidity (3)
 * 5. leverage-down: long-term debt / average total assets is lower in t than in t-1, or zero in both.
 * 6. current-ratio-up: current assets / current liabilities at E(t) is above the same ratio at E(t-1).
 * 7. no-dilution: diluted weighted average shares in t are no more than in t-1 (stands in for "no new common
 *    equity issued"; later filings restate earlier share counts for splits).
 * Efficiency (2)
 * 8. gross-margin-up: gross profit / revenue is above the year before.
 * 9. asset-turnover-up: revenue / total assets at the start of the year is above the year before.
 *
 * A test whose input is not in the facts is `null` (not available), never a guess. The score is the count of
 * passes and is only a full F-score when all nine tests could be run.
 */
import type { FinancialFact } from './adapters/sec-facts.js';
import { annualValues, instantValues, pointInTime, preferConcepts } from './fundamentals.js';

export const PIOTROSKI_VERSION = 'piotroski-1';

/** The concepts piotroski-1 reads; the facts job stores them through STUDY_CONCEPTS. */
export const PIOTROSKI_CONCEPTS = [
  'NetIncomeLoss',
  'NetCashProvidedByUsedInOperatingActivities',
  'Assets',
  'AssetsCurrent',
  'LiabilitiesCurrent',
  'LongTermDebtNoncurrent',
  'LongTermDebt',
  'WeightedAverageNumberOfDilutedSharesOutstanding',
  'GrossProfit',
  'Revenues',
  'RevenueFromContractWithCustomerExcludingAssessedTax',
] as const;

export type PiotroskiGroup = 'profitability' | 'leverage' | 'efficiency';
export type PiotroskiTestId =
  | 'roa-positive'
  | 'cfo-positive'
  | 'roa-up'
  | 'accruals'
  | 'leverage-down'
  | 'current-ratio-up'
  | 'no-dilution'
  | 'gross-margin-up'
  | 'asset-turnover-up';

export interface PiotroskiTest {
  id: PiotroskiTestId;
  group: PiotroskiGroup;
  /** Null when an input is missing. */
  passed: boolean | null;
  /** The figure for year t (a ratio, a count of shares, or dollars for cfo-positive). */
  current: number | null;
  /** The figure it is compared with: year t-1, or 0 for the level tests. */
  prior: number | null;
  /** Names of the inputs that were missing, for the "not available" line. */
  missing: string[];
}

export interface PiotroskiYear {
  start: string;
  end: string;
}

export interface PiotroskiResult {
  formulaVersion: string;
  asOf: string;
  year: PiotroskiYear | null;
  priorYear: PiotroskiYear | null;
  /** The newest filing date among year t's inputs, and its accession. */
  filed: string | null;
  accession: string | null;
  tests: PiotroskiTest[];
  passed: number;
  available: number;
  /** The full score (0 to 9) only when all nine tests could be run; null otherwise. */
  score: number | null;
  groups: Record<PiotroskiGroup, { passed: number; available: number; of: number }>;
}

const DAY = 86_400_000;
const days = (d: string) => Date.parse(`${d}T00:00:00Z`) / DAY;
const dayBefore = (d: string) =>
  new Date(Date.parse(`${d}T00:00:00Z`) - DAY).toISOString().slice(0, 10);

const GROUP: Record<PiotroskiTestId, PiotroskiGroup> = {
  'roa-positive': 'profitability',
  'cfo-positive': 'profitability',
  'roa-up': 'profitability',
  accruals: 'profitability',
  'leverage-down': 'leverage',
  'current-ratio-up': 'leverage',
  'no-dilution': 'leverage',
  'gross-margin-up': 'efficiency',
  'asset-turnover-up': 'efficiency',
};

interface Val {
  value: number;
  filed: string;
  accession: string;
}

/** Annual values of the first concept that reports a period, keyed by period end. */
function annual(facts: readonly FinancialFact[], concepts: readonly string[], unit: string) {
  const out = new Map<string, Val & { start: string }>();
  for (const p of annualValues(preferConcepts(facts, concepts, unit)))
    if (p.value !== null && p.filed && p.accession)
      out.set(p.end, { value: p.value, filed: p.filed, accession: p.accession, start: p.start });
  return out;
}

/** Balance-sheet values keyed by date. */
function instant(facts: readonly FinancialFact[], concepts: readonly string[]) {
  const out = new Map<string, Val>();
  for (const { end, metric } of instantValues(preferConcepts(facts, concepts, 'USD')))
    if (metric.value !== null && metric.filed && metric.accession)
      out.set(end, { value: metric.value, filed: metric.filed, accession: metric.accession });
  return out;
}

const ratio = (a: number | null, b: number | null): number | null =>
  a === null || b === null || b <= 0 ? null : a / b;

export function piotroskiScore(all: readonly FinancialFact[], asOf: string): PiotroskiResult {
  const facts = pointInTime(all, asOf);
  const ni = annual(facts, ['NetIncomeLoss'], 'USD');
  const cfo = annual(facts, ['NetCashProvidedByUsedInOperatingActivities'], 'USD');
  const rev = annual(
    facts,
    ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax'],
    'USD',
  );
  const gp = annual(facts, ['GrossProfit'], 'USD');
  const sh = annual(facts, ['WeightedAverageNumberOfDilutedSharesOutstanding'], 'shares');
  const assets = instant(facts, ['Assets']);
  const ca = instant(facts, ['AssetsCurrent']);
  const cl = instant(facts, ['LiabilitiesCurrent']);
  // One debt concept for every date, so the years compare like with like.
  const ltdNon = instant(facts, ['LongTermDebtNoncurrent']);
  const ltdAll = instant(facts, ['LongTermDebt']);

  const ends = [...ni.keys()].sort();
  const tEnd = ends.at(-1) ?? null;
  const t = tEnd ? (ni.get(tEnd) ?? null) : null;
  const pEnd = tEnd
    ? ([...ends].reverse().find((e) => {
        const gap = days(tEnd) - days(e);
        return gap >= 350 && gap <= 380;
      }) ?? null)
    : null;
  const p = pEnd ? (ni.get(pEnd) ?? null) : null;

  const year: PiotroskiYear | null = t && tEnd ? { start: t.start, end: tEnd } : null;
  const priorYear: PiotroskiYear | null = p && pEnd ? { start: p.start, end: pEnd } : null;
  const e0 = tEnd;
  const e1 = year ? dayBefore(year.start) : null;
  const e2 = priorYear ? dayBefore(priorYear.start) : null;

  const at = <V>(m: Map<string, V>, k: string | null): V | null => (k ? (m.get(k) ?? null) : null);
  const v = (x: Val | null) => (x ? x.value : null);

  const used: (Val | null)[] = [];
  const take = (x: Val | null) => {
    used.push(x);
    return v(x);
  };

  const tests: PiotroskiTest[] = [];
  const add = (
    id: PiotroskiTestId,
    current: number | null,
    prior: number | null,
    pass: (c: number, p: number) => boolean,
    inputs: Record<string, number | null>,
  ) => {
    const missing = Object.entries(inputs)
      .filter(([, x]) => x === null)
      .map(([k]) => k);
    const ok = current !== null && prior !== null && missing.length === 0;
    tests.push({
      id,
      group: GROUP[id],
      passed: ok ? pass(current, prior) : null,
      current,
      prior,
      missing,
    });
  };

  const niT = take(t);
  const niP = v(p);
  const aE1 = take(at(assets, e1));
  const aE2 = v(at(assets, e2));
  const aE0 = take(at(assets, e0));
  const cfoT = take(at(cfo, tEnd));
  const roaT = ratio(niT, aE1);
  const roaP = ratio(niP, aE2);

  add('roa-positive', roaT, 0, (c) => c > 0, { 'net income': niT, 'total assets': aE1 });
  add('cfo-positive', cfoT, 0, (c) => c > 0, { 'operating cash flow': cfoT });
  add('roa-up', roaT, roaP, (c, q) => c > q, {
    'net income': niT,
    'prior net income': niP,
    'total assets': aE1,
    'prior total assets': aE2,
  });
  add('accruals', ratio(cfoT, aE1), roaT, (c, q) => c > q, {
    'operating cash flow': cfoT,
    'net income': niT,
    'total assets': aE1,
  });

  // Long-term debt: the noncurrent part when it is reported at all three dates, else total long-term debt.
  const debt = [e0, e1, e2].every((d) => d && ltdNon.has(d)) ? ltdNon : ltdAll;
  const dT = take(at(debt, e0));
  const dP = v(at(debt, e1));
  const avgT = aE0 !== null && aE1 !== null ? (aE0 + aE1) / 2 : null;
  const avgP = aE1 !== null && aE2 !== null ? (aE1 + aE2) / 2 : null;
  add('leverage-down', ratio(dT, avgT), ratio(dP, avgP), (c, q) => c < q || (c === 0 && q === 0), {
    'long-term debt': dT,
    'prior long-term debt': dP,
    'total assets': aE0,
    'prior total assets': aE2,
  });

  const caT = take(at(ca, e0));
  const clT = take(at(cl, e0));
  const caP = v(at(ca, e1));
  const clP = v(at(cl, e1));
  add('current-ratio-up', ratio(caT, clT), ratio(caP, clP), (c, q) => c > q, {
    'current assets': caT,
    'current liabilities': clT,
    'prior current assets': caP,
    'prior current liabilities': clP,
  });

  const shT = take(at(sh, tEnd));
  const shP = v(at(sh, pEnd));
  add('no-dilution', shT, shP, (c, q) => c <= q, {
    'diluted shares': shT,
    'prior diluted shares': shP,
  });

  const revT = take(at(rev, tEnd));
  const revP = v(at(rev, pEnd));
  const gpT = take(at(gp, tEnd));
  const gpP = v(at(gp, pEnd));
  add('gross-margin-up', ratio(gpT, revT), ratio(gpP, revP), (c, q) => c > q, {
    'gross profit': gpT,
    revenue: revT,
    'prior gross profit': gpP,
    'prior revenue': revP,
  });
  add('asset-turnover-up', ratio(revT, aE1), ratio(revP, aE2), (c, q) => c > q, {
    revenue: revT,
    'prior revenue': revP,
    'total assets': aE1,
    'prior total assets': aE2,
  });

  let filed: string | null = null;
  let accession: string | null = null;
  for (const u of used)
    if (u && (filed === null || u.filed > filed)) {
      filed = u.filed;
      accession = u.accession;
    }

  const groups: PiotroskiResult['groups'] = {
    profitability: { passed: 0, available: 0, of: 4 },
    leverage: { passed: 0, available: 0, of: 3 },
    efficiency: { passed: 0, available: 0, of: 2 },
  };
  for (const x of tests) {
    if (x.passed === null) continue;
    groups[x.group].available += 1;
    if (x.passed) groups[x.group].passed += 1;
  }
  const available = tests.filter((x) => x.passed !== null).length;
  const passed = tests.filter((x) => x.passed === true).length;
  return {
    formulaVersion: PIOTROSKI_VERSION,
    asOf,
    year,
    priorYear,
    filed,
    accession,
    tests,
    passed,
    available,
    score: available === 9 ? passed : null,
    groups,
  };
}
