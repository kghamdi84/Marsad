/**
 * Provenance and freshness: every number Marsad shows carries where it came from,
 * when it is as-of, and how fresh it is. Silence must never look like calm, so a
 * missing or old value is labelled, never hidden.
 */
import { formatClock, US_EASTERN } from './time.js';
import {
  etDate,
  lastRegularClose,
  sessionInfo,
  type MarketCalendar,
  type SessionState,
} from './calendar.js';

export type PlanTier = 'real-time' | 'delayed' | 'end-of-day' | 'unavailable' | 'unknown';
export type FreshnessState = 'live' | 'delayed' | 'stale' | 'unavailable';

export interface Provenance {
  source: string; // 'massive', 'tauric', 'fred', 'sec_edgar', 'nasdaq_halts', 'gpr', or 'marsad' for derived values
  endpoint: string;
  asOf: string; // UTC ISO 8601, the time the value describes
  fetchedAt: string; // UTC ISO 8601, when Marsad received it
  planTier: PlanTier;
  /** Set on derived values: the formula and its version, for example 'ema@1'. */
  formulaVersion?: string;
}

/** A value with its provenance. `value` is null when the source had nothing (see `reason`). */
export interface Sourced<T> {
  value: T | null;
  provenance: Provenance;
  reason?: string;
}

/** The delay of 'delayed' plan tiers, in seconds. Massive's delayed tiers are 15 minutes. */
export const DELAYED_TIER_SECONDS = 15 * 60;

/** Allowed age of a real-time intraday value before it is stale, by session state. */
export const MAX_AGE_SECONDS = {
  regular: 90, // polled every 15 s, so 90 s is six missed polls
  extended: 300, // pre-market and after-hours trade thinly
} as const;

export interface FreshnessInput {
  asOf: Date | null;
  now: Date;
  planTier: PlanTier;
  calendar: MarketCalendar;
}

export interface Freshness {
  state: FreshnessState;
  ageSeconds: number | null;
  session: SessionState;
  /** Text for the UI. State is always shown as words, never by color alone. */
  label: string;
}

export function formatAge(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

/**
 * Freshness of an intraday or end-of-day value.
 *
 * - Real-time and delayed tiers: during a session the value must be younger than
 *   the session's limit (plus 15 minutes for the delayed tier). When the market is
 *   closed the value is current if it is at or after the last regular close.
 * - End-of-day tier: current if its ET date is the last completed trading day or later.
 * - Unknown tier (a vendor whose delay has not been measured): judged with the delayed tier's allowance,
 *   but never called "Live". Its state is `delayed` and its label says the delay is not confirmed, so a
 *   feed of unproven speed cannot pass as real time (ADR 0041).
 * - No value, or an unavailable plan tier: unavailable.
 */
export function evaluateFreshness(input: FreshnessInput): Freshness {
  const { asOf, now, planTier, calendar } = input;
  const info = sessionInfo(now, calendar);
  const session = info.state;
  if (asOf === null || Number.isNaN(asOf.getTime()) || planTier === 'unavailable') {
    return { state: 'unavailable', ageSeconds: null, session, label: 'Unavailable' };
  }
  const ageSeconds = (now.getTime() - asOf.getTime()) / 1000;
  const stale = (): Freshness => ({
    state: 'stale',
    ageSeconds,
    session,
    label: `Stale, ${formatAge(ageSeconds)} old`,
  });

  if (planTier === 'end-of-day') {
    const lastClose = lastRegularClose(now, calendar);
    if (lastClose === null) return { state: 'live', ageSeconds, session, label: 'End of day' };
    return etDate(asOf) >= etDate(lastClose)
      ? { state: 'live', ageSeconds, session, label: `End of day, ${etDate(asOf)}` }
      : stale();
  }

  const delay = planTier === 'delayed' || planTier === 'unknown' ? DELAYED_TIER_SECONDS : 0;
  const current = (): Freshness => {
    if (planTier === 'delayed')
      return { state: 'delayed', ageSeconds, session, label: 'Delayed 15 min' };
    if (planTier === 'unknown')
      return { state: 'delayed', ageSeconds, session, label: 'Delay not confirmed' };
    return { state: 'live', ageSeconds, session, label: 'Live' };
  };

  if (session === 'closed') {
    const lastClose = lastRegularClose(now, calendar);
    if (lastClose === null) return stale();
    // A 60 s tolerance covers closing-print timestamps just before the bell.
    if (asOf.getTime() >= lastClose.getTime() - 60_000) {
      const at = formatClock(lastClose, US_EASTERN);
      return { ...current(), label: `Market closed, last value ${at} ET` };
    }
    return stale();
  }
  const limit =
    (session === 'regular' ? MAX_AGE_SECONDS.regular : MAX_AGE_SECONDS.extended) + delay;
  return ageSeconds <= limit ? current() : stale();
}

/** The worst (least fresh) state in a list, used for panels that combine several values. */
export function worstState(states: readonly FreshnessState[]): FreshnessState {
  const order: FreshnessState[] = ['unavailable', 'stale', 'delayed', 'live'];
  for (const s of order) if (states.includes(s)) return s;
  return 'unavailable';
}
