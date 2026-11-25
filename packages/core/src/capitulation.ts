/**
 * Capitulation watch (ADR 0011, `capitulation-1`): four conditions on the close, and a staged-entry plan for index
 * ETFs that lists conditions, never orders. Pure: the caller supplies every series.
 */
import type { Obs, RecessionLevel } from './regime.js';
import { movingAverage } from './feargreed.js';
import type { AlertInput, Reading } from './alerts.js';
import { MIN_CASES } from './stats.js';
import { toFixedHalfUp } from './ai/template.js';

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

/** Marsad's stored event study for the watch's longer-history proxy, at one horizon. */
export interface ProxyStudy {
  horizon: number;
  n: number;
  median: number | null;
  q1: number | null;
  q3: number | null;
  dataFrom: string;
  /** Episode start dates, for counting losses at the horizon. */
  episodes: readonly string[];
}

/** Episodes whose close `horizon` sessions later was below the start close; episodes without that close are left out. */
export function episodeLosses(
  series: readonly Obs[],
  episodes: readonly string[],
  horizon: number,
): { n: number; losses: number } {
  const at = new Map(series.map((o, i) => [o.date, i]));
  let n = 0;
  let losses = 0;
  for (const e of episodes) {
    const i = at.get(e);
    const later = i === undefined ? undefined : series[i + horizon];
    const start = i === undefined ? undefined : series[i];
    if (start === undefined || later === undefined) continue;
    n += 1;
    if (later.value < start.value) losses += 1;
  }
  return { n, losses };
}

const signedPct = (v: number) => `${v >= 0 ? '+' : ''}${toFixedHalfUp(v * 100, 1)}%`;
const CONDITION_TEXT: Record<ConditionKey, (c: Condition) => string> = {
  vix: (c) => `VIX ${toFixedHalfUp(Number(c.value), 1)} (at least ${CAPITULATION_RULES.vixMin})`,
  breadth: (c) =>
    `${toFixedHalfUp(Number(c.value), 1)}% of the Marsad universe above its 50-day average (at most ${CAPITULATION_RULES.above50MaxPct}%)`,
  composite: (c) =>
    `Fear and Greed composite ${toFixedHalfUp(Number(c.value), 0)} (at most ${CAPITULATION_RULES.compositeMax})`,
  recession: (c) => `recession filter ${String(c.value)} (not high)`,
};

/**
 * The regime alert for the first day the watch turns on (the brief's example 3). Its plan lists conditions for
 * staged index-ETF entries, never orders; history comes from Marsad's own proxy event study with n, and under 30
 * episodes the card says so instead of giving a rate. `storedAt` is when the inputs were stored (end-of-day data).
 */
export function capitulationAlert(
  day: CapitulationDay,
  plan: StagedPlan | null,
  study: (ProxyStudy & { losses: { n: number; losses: number } }) | null,
  context: { vix?: Reading; regime?: string },
  storedAt: Date,
  now: Date,
): AlertInput {
  const r = CAPITULATION_RULES;
  const studyText =
    study === null
      ? 'Marsad event study: not computed yet.'
      : study.n < MIN_CASES || study.median === null || study.q1 === null || study.q3 === null
        ? `Marsad event study (VIX close at least 30 with the recession filter not high, S&P 500 since ${study.dataFrom}): n=${study.n} episodes, insufficient history for a rate.`
        : `Marsad event study (VIX close at least 30 with the recession filter not high, S&P 500 since ${study.dataFrom}): ${study.horizon}-session forward return median ${signedPct(study.median)}, 25th percentile ${signedPct(study.q1)}, 75th percentile ${signedPct(study.q3)}, n=${study.n} episodes.`;
  const levels =
    plan === null
      ? 'SPY levels unavailable (no SPY bar for the trigger day).'
      : `SPY trigger close ${toFixedHalfUp(plan.triggerClose, 2)}; selloff low ${toFixedHalfUp(plan.selloffLow, 2)}; review below ${toFixedHalfUp(plan.triggerClose * (1 - r.reviewDrawdown), 2)}.`;
  return {
    kind: 'regime',
    priority: 'high',
    ruleId: 'capitulation-watch',
    ruleVersion: 1,
    ruleStatus: 'live',
    eventId: `capitulation:${day.date}`,
    headline: 'Capitulation watch ON',
    trigger: `Trigger at the close of ${day.date}: ${day.conditions.map((c) => CONDITION_TEXT[c.key](c)).join('; ')}. ${studyText}`,
    plan: {
      entry: `Staged entries in index ETFs, as conditions, not orders: one third at the trigger close; one third on a retest of the selloff low (within ${r.retestBand * 100}%, at least ${r.retestMinSessions} sessions later); one third on a close above the ${r.reclaimSessions}-day average. ${levels}`,
      invalidation: `Pause every remaining third if the recession filter turns high; review if SPY closes more than ${r.reviewDrawdown * 100}% below the trigger close; the plan expires after ${r.planSessions} sessions.`,
    },
    risk: [
      { horizon: 'scalp', losses: 0, n: null },
      { horizon: 'swing', losses: 0, n: null },
      { horizon: 'long', losses: study?.losses.losses ?? 0, n: study?.losses.n ?? 0 },
    ],
    context: { ...context, news: [] },
    bearCase:
      'In 2008 the VIX stayed above 30 for weeks while the decline continued, and in 2022 the market made new lows months after its first volatility spike. Staging limits the damage if this is one of those episodes, and the recession filter pauses the plan if the economy turns.',
    sources: [
      { id: 'capitulation_daily', label: `Capitulation watch ${day.version}`, asOf: day.date },
      ...(study
        ? [{ id: 'regime_event_stats', label: 'Marsad event study', asOf: study.dataFrom }]
        : []),
    ],
    worstAgeSeconds: Math.max(0, Math.round((now.getTime() - storedAt.getTime()) / 1000)),
    // Close-based: judged after the session, so the inputs are up to a day old by design.
    maxAgeSeconds: 26 * 3600,
    delayed: true,
  };
}
