/**
 * Replay mode (ADR 0018): re-runs a rule on stored bars for one date and lists every comparison with the values it
 * used, so a stored signal can be reproduced and explained. Uses the same evaluator as the backtester and alerts.
 */
import { RuleEvaluator, type RuleCondition, type RuleDoc, type RuleExpr } from './rules.js';
import type { DailyBar } from './study.js';

export interface ReplayTerm {
  /** Where the comparison sits in the rule, for example "entry.all[2]". */
  path: string;
  left: number | null;
  op: string;
  right: number | null;
  holds: boolean | null;
}

export interface Replay {
  date: string;
  entry: boolean | null;
  exit: boolean | null;
  terms: ReplayTerm[];
}

/** The rule's entry and exit on `date` (a bar date), with each comparison's values. Null when the date has no bar. */
export function replayDay(rule: RuleDoc, bars: readonly DailyBar[], date: string): Replay | null {
  const i = bars.findIndex((b) => b.date === date);
  if (i < 0) return null;
  // Only bars up to the date: replay can never see later data.
  const ev = new RuleEvaluator(bars.slice(0, i + 1));
  const terms: ReplayTerm[] = [];
  const walk = (c: RuleCondition, path: string) => {
    if ('all' in c) c.all.forEach((x, k) => walk(x, `${path}.all[${k}]`));
    else if ('any' in c) c.any.forEach((x, k) => walk(x, `${path}.any[${k}]`));
    else if ('not' in c) walk(c.not, `${path}.not`);
    else
      terms.push({
        path,
        left: ev.value(c.left as RuleExpr, i),
        op: c.op,
        right: ev.value(c.right as RuleExpr, i),
        holds: ev.holds(c, i),
      });
  };
  walk(rule.entry, 'entry');
  if (rule.exit) walk(rule.exit, 'exit');
  return {
    date,
    entry: ev.holds(rule.entry, i),
    exit: rule.exit ? ev.holds(rule.exit, i) : null,
    terms,
  };
}
