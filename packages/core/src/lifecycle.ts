/**
 * Rule lifecycle (ADR 0018, integrity rule 11): draft, backtested, shadow, live, demoted. Pure gate checks; the
 * runner and the database apply them. Live versions never change; an edit is a new version that starts as a draft.
 */
import type { Interval } from './stats.js';

export type RuleStatus = 'draft' | 'backtested' | 'shadow' | 'live' | 'demoted';

export interface GateResult {
  ok: boolean;
  /** Why it passes or fails, in plain words. */
  reason: string;
}

/** Draft to backtested: out-of-sample expectancy after costs is positive and its 90% interval excludes zero. */
export function backtestGate(oos: {
  n: number;
  expectancy: number | null;
  ci90: Interval | null;
}): GateResult {
  if (oos.n < 30) return { ok: false, reason: `only ${oos.n} out-of-sample trades; 30 are needed` };
  if (oos.expectancy === null || oos.ci90 === null)
    return { ok: false, reason: 'no out-of-sample expectancy' };
  if (oos.expectancy <= 0)
    return { ok: false, reason: 'out-of-sample expectancy after costs is not positive' };
  if (oos.ci90.low <= 0)
    return { ok: false, reason: 'the 90% interval of the expectancy includes zero' };
  return { ok: true, reason: 'positive out-of-sample expectancy with a 90% interval above zero' };
}

/** Shadow to live: at least 20 trading days and 15 signals in shadow (logged, not pushed). */
export function shadowGate(shadow: { tradingDays: number; signals: number }): GateResult {
  if (shadow.tradingDays < 20)
    return { ok: false, reason: `${shadow.tradingDays} trading days in shadow; 20 are needed` };
  if (shadow.signals < 15)
    return { ok: false, reason: `${shadow.signals} shadow signals; 15 are needed` };
  return { ok: true, reason: 'at least 20 trading days and 15 signals in shadow' };
}

/** Live to demoted: the rolling 30-signal live expectancy falls below the backtest's lower 90% bound. */
export function demotionCheck(live: readonly number[], backtestLow: number): GateResult {
  if (live.length < 30)
    return { ok: false, reason: `${live.length} live signals; the check needs 30` };
  const last = live.slice(-30);
  const avg = last.reduce((s, x) => s + x, 0) / last.length;
  return avg < backtestLow
    ? { ok: true, reason: 'the last 30 live signals averaged below the backtest’s lower 90% bound' }
    : { ok: false, reason: 'the last 30 live signals are within the backtest’s range' };
}

const NEXT: Record<RuleStatus, RuleStatus[]> = {
  draft: ['backtested'],
  backtested: ['shadow', 'draft'],
  shadow: ['live', 'backtested'],
  live: ['demoted'],
  demoted: ['draft'],
};

/** Whether a status change is allowed at all (the gates decide whether it is earned). */
export function canMove(from: RuleStatus, to: RuleStatus): boolean {
  return NEXT[from].includes(to);
}
