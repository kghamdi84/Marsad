/**
 * Capitulation watch (ADR 0011, `capitulation-1`): four conditions on the close, and a staged-entry plan for index
 * ETFs that lists conditions, never orders. Pure: the caller supplies every series.
 */
import type { Obs, RecessionLevel } from './regime.js';
import { movingAverage } from './feargreed.js';

export const CAPITULATION_VERSION = 'capitulation-1';

export const CAPITULATION_RULES = Object.freeze({
  vixMin: 30,
  above50MaxPct: 15,
  compositeMax: 15,
  minMembers: 500,
  lowLookback: 10,
  retestBand: 0.02,
  retestMinSessions: 5,
  reclaimSessions: 50,
  planSessions: 126,
  reviewDrawdown: 0.1,
});

export type ConditionKey = 'vix' | 'breadth' | 'composite' | 'recession';
export type CapitulationState = 'on' | 'off' | 'unavailable';

export interface Condition {
  key: ConditionKey;
  /** VIX close; percent above the 50-day average; composite; or the recession level. */
  value: number | string | null;
  threshold: string;
  /** null when there is no data. */
  met: boolean | null;
}

export interface CapitulationInputs {
  date: string;
  vix: number | null;
  above50: number | null;
  n50: number | null;
  composite: number | null;
  recession: RecessionLevel | null;
}

export interface CapitulationDay {
  date: string;
  version: string;
  state: CapitulationState;
  conditions: Condition[];
}

export function capitulationDay(x: CapitulationInputs): CapitulationDay {
  const r = CAPITULATION_RULES;
  const pct =
    x.above50 !== null && x.n50 !== null && x.n50 >= r.minMembers
      ? (100 * x.above50) / x.n50
      : null;
  const rec = x.recession === 'unavailable' ? null : x.recession;
  const conditions: Condition[] = [
    {
      key: 'vix',
      value: x.vix,
      threshold: `>= ${r.vixMin}`,
      met: x.vix === null ? null : x.vix >= r.vixMin,
    },
    {
      key: 'breadth',
      value: pct,
      threshold: `<= ${r.above50MaxPct}%`,
      met: pct === null ? null : pct <= r.above50MaxPct,
    },
    {
      key: 'composite',
      value: x.composite,
      threshold: `<= ${r.compositeMax}`,
      met: x.composite === null ? null : x.composite <= r.compositeMax,
    },
    {
      key: 'recession',
      value: rec,
      threshold: 'not high',
      met: rec === null ? null : rec !== 'high',
    },
  ];
  const state: CapitulationState = conditions.some((c) => c.met === false)
    ? 'off'
    : conditions.some((c) => c.met === null)
      ? 'unavailable'
      : 'on';
  return { date: x.date, version: CAPITULATION_VERSION, state, conditions };
}

/** The first day of each run of "on" days. */
export function capitulationTriggers(days: readonly CapitulationDay[]): string[] {
  return days.flatMap((d, i) =>
    d.state === 'on' && (i === 0 || days[i - 1]?.state !== 'on') ? [d.date] : [],
  );
}

export interface SpyBar {
  date: string;
  low: number;
  close: number;
}

export type TrancheStatus = 'met' | 'waiting' | 'paused' | 'expired';

export interface Tranche {
  step: 1 | 2 | 3;
  status: TrancheStatus;
  /** The session the condition was met. */
  date: string | null;
  /** The reference level: trigger close, low of the selloff, or the 50-day average (latest). */
  level: number | null;
}

export interface StagedPlan {
  version: string;
  triggerDate: string;
  triggerClose: number;
  selloffLow: number;
  sessionsSince: number;
  expired: boolean;
  /** First session the recession filter read high after the trigger. */
  pausedOn: string | null;
  /** First close more than 10% below the trigger close. */
  reviewOn: string | null;
  tranches: Tranche[];
}

/**
 * The staged-entry plan of the episode that started on `triggerDate`, evaluated on SPY bars up to the newest one.
 * Returns null when the trigger date has no SPY bar.
 */
export function stagedPlan(
  triggerDate: string,
  spy: readonly SpyBar[],
  recession: ReadonlyMap<string, RecessionLevel>,
): StagedPlan | null {
  const r = CAPITULATION_RULES;
  const t = spy.findIndex((b) => b.date === triggerDate);
  if (t < 0) return null;
  const trigger = spy[t] as SpyBar;
  const ma = new Map(
    movingAverage(
      spy.map((b) => ({ date: b.date, value: b.close })),
      r.reclaimSessions,
    ).map((o) => [o.date, o.value]),
  );
  const last = spy.length - 1;
  const end = Math.min(last, t + r.planSessions);
  const expired = last > t + r.planSessions;

  let lowIdx = t;
  for (let i = Math.max(0, t - r.lowLookback + 1); i <= t; i++)
    if ((spy[i] as SpyBar).close < (spy[lowIdx] as SpyBar).close) lowIdx = i;
  let low = (spy[lowIdx] as SpyBar).close;
  let retest: string | null = null;
  let reclaim: string | null = null;
  let pausedOn: string | null = null;
  let reviewOn: string | null = null;
  for (let i = t + 1; i <= end; i++) {
    const b = spy[i] as SpyBar;
    if (pausedOn === null && recession.get(b.date) === 'high') pausedOn = b.date;
    if (reviewOn === null && b.close < trigger.close * (1 - r.reviewDrawdown)) reviewOn = b.date;
    if (retest === null) {
      if (b.close < low) {
        low = b.close;
        lowIdx = i;
      } else if (i - lowIdx >= r.retestMinSessions && b.low <= low * (1 + r.retestBand))
        retest = b.date;
    }
    const avg = ma.get(b.date);
    if (reclaim === null && avg !== undefined && b.close > avg) reclaim = b.date;
  }
  const status = (date: string | null): TrancheStatus => {
    if (date !== null && (pausedOn === null || date < pausedOn)) return 'met';
    if (pausedOn !== null) return 'paused';
    return expired ? 'expired' : 'waiting';
  };
  const lastMa = ma.get((spy[last] as SpyBar).date) ?? null;
  return {
    version: CAPITULATION_VERSION,
    triggerDate,
    triggerClose: trigger.close,
    selloffLow: low,
    sessionsSince: last - t,
    expired,
    pausedOn,
    reviewOn,
    tranches: [
      { step: 1, status: 'met', date: triggerDate, level: trigger.close },
      { step: 2, status: status(retest), date: retest, level: low },
      { step: 3, status: status(reclaim), date: reclaim, level: lastMa },
    ],
  };
}

/** Builds each day's inputs from stored series keyed by date. */
export function capitulationHistory(
  dates: readonly string[],
  vix: readonly Obs[],
  breadth: ReadonlyMap<string, { above50: number; n50: number }>,
  composite: ReadonlyMap<string, number | null>,
  recession: ReadonlyMap<string, RecessionLevel>,
): CapitulationDay[] {
  const v = new Map(vix.map((o) => [o.date, o.value]));
  return dates.map((date) => {
    const b = breadth.get(date);
    return capitulationDay({
      date,
      vix: v.get(date) ?? null,
      above50: b?.above50 ?? null,
      n50: b?.n50 ?? null,
      composite: composite.get(date) ?? null,
      recession: recession.get(date) ?? null,
    });
  });
}
