/**
 * The cost tracker (ADR 0028, `costs-1`): fixed monthly plan costs, AI spend against Khaled's caps (warning at
 * 80%, templates at the cap; integrity rule 18), and an estimate of GitHub Actions minutes from the job log.
 * Pure: the page passes the stored rows.
 */
import { evaluateBudget, type BudgetStatus, type Caps } from './ai/cost.js';

export const COSTS_VERSION = 'costs-1';

/** What each service costs Marsad today, by plan. Changing a plan is Khaled's decision; update this list then. */
export const PLAN_COSTS: readonly {
  service: string;
  plan: string;
  usdPerMonth: number;
  note: string;
}[] = [
  {
    service: 'Supabase',
    plan: 'Free',
    usdPerMonth: 0,
    note: 'Pro (USD 25 a month) is a Phase 5 prerequisite, not bought.',
  },
  { service: 'Netlify', plan: 'Free', usdPerMonth: 0, note: 'Personal team GIG, site marsad-k84.' },
  {
    service: 'Massive',
    plan: 'Free',
    usdPerMonth: 0,
    note: 'End-of-day data, about 5 calls a minute. Stocks and Options plans not bought.',
  },
  {
    service: 'FRED, SEC EDGAR, Nasdaq Trader',
    plan: 'Public',
    usdPerMonth: 0,
    note: 'Free public sources.',
  },
  {
    service: 'Anthropic API',
    plan: 'Not set up',
    usdPerMonth: 0,
    note: 'Usage-based once a key and caps exist; tracked below.',
  },
  {
    service: 'GitHub Actions',
    plan: 'Account plan',
    usdPerMonth: 0,
    note: 'Minutes estimated below from the job log.',
  },
];

export interface UsageRow {
  createdAt: string;
  model: string;
  usd: number;
}

export interface AiSpend {
  todayUsd: number;
  monthUsd: number;
  calls: number;
  byModel: { model: string; usd: number; calls: number }[];
  /** Null when no caps are set: AI stays off until they are. */
  budget: BudgetStatus | null;
}

/** AI spend today and this month (UTC), by model, against the caps. */
export function aiSpend(rows: readonly UsageRow[], now: Date, caps: Caps | null): AiSpend {
  const day = now.toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  const thisMonth = rows.filter((r) => r.createdAt.slice(0, 7) === month);
  const todayUsd = thisMonth
    .filter((r) => r.createdAt.slice(0, 10) === day)
    .reduce((a, r) => a + r.usd, 0);
  const monthUsd = thisMonth.reduce((a, r) => a + r.usd, 0);
  const by = new Map<string, { usd: number; calls: number }>();
  for (const r of thisMonth) {
    const m = by.get(r.model) ?? { usd: 0, calls: 0 };
    m.usd += r.usd;
    m.calls += 1;
    by.set(r.model, m);
  }
  return {
    todayUsd,
    monthUsd,
    calls: thisMonth.length,
    byModel: [...by.entries()].map(([model, v]) => ({ model, ...v })).sort((a, b) => b.usd - a.usd),
    budget: caps ? evaluateBudget({ dailyUsd: todayUsd, monthlyUsd: monthUsd }, caps) : null,
  };
}

/**
 * GitHub Actions minutes this month (UTC), estimated from job run durations: GitHub bills each job rounded up to
 * the whole minute, and a workflow's setup (checkout, install) adds about a minute the job log does not see, so
 * this is a lower bound. One run can hold several jobs (a workflow's steps), counted once here.
 */
export function actionsMinutes(
  runs: readonly { startedAt: string; latencyMs: number | null }[],
  now: Date,
): { runs: number; minutes: number } {
  const month = now.toISOString().slice(0, 7);
  const mine = runs.filter((r) => r.startedAt.slice(0, 7) === month && r.latencyMs !== null);
  return {
    runs: mine.length,
    minutes: mine.reduce((a, r) => a + Math.max(1, Math.ceil((r.latencyMs as number) / 60_000)), 0),
  };
}
