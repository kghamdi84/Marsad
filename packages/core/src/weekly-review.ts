/**
 * The weekly review (ADR 0029, `weekly-review-1`), written from templates: results and behavior side by side,
 * including where Khaled broke his own rules, the week's alerts and his feedback, and each rule's scorecard. Code
 * computes every number; when the AI layer is enabled it may add prose around the same numbers, verified against
 * this payload. Pure.
 */
import { toFixedHalfUp } from './ai/template.js';
import type { Brief, BriefSection } from './briefs.js';
import { adherence, pnl, rMultiple, type JournalTrade } from './journal.js';
import type { RuleSummary } from './scorecard.js';

export const WEEKLY_REVIEW_VERSION = 'weekly-review-1';

export interface WeeklyInputs {
  /** The review covers the 7 days ending on this date (UTC), inclusive. */
  weekEnding: string;
  trades: readonly JournalTrade[];
  /** Alerts created in the week. */
  alerts: readonly { kind: string; decision: string }[];
  /** Feedback given in the week. */
  feedback: readonly { verdict: string }[];
  /** Scorecard rows at 5 sessions. */
  scorecard: readonly RuleSummary[];
  regime: string | null;
}

const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const money = (v: number) => `${v < 0 ? '-' : ''}USD ${toFixedHalfUp(Math.abs(v), 2)}`;
const r1 = (v: number) => `${v > 0 ? '+' : ''}${toFixedHalfUp(v, 2)}R`;

/** "Followed the plan": an adherence score of 80 or more, the same line the Journal uses. */
export const PLAN_FOLLOWED_AT = 80;

export interface WeeklyTiles {
  /** Trades closed in the week. */
  closed: number;
  /** Trades touched in the week (opened or closed) whose adherence was 80 or more, of all touched. */
  followed: number;
  touched: number;
  /** Mean result in R of the closed trades with a stop; null when none. */
  meanR: number | null;
}

/** The design's tiles for the weekly review, from the same stored inputs as the text. */
export function weeklyTiles(x: Pick<WeeklyInputs, 'weekEnding' | 'trades'>): WeeklyTiles {
  const start = addDays(x.weekEnding, -6);
  const inWeek = (d: string | null) => d !== null && d >= start && d <= x.weekEnding;
  const closed = x.trades.filter((t) => inWeek(t.exitDate));
  const touched = x.trades.filter((t) => inWeek(t.entryDate) || inWeek(t.exitDate));
  const rs = closed.map(rMultiple).filter((v): v is number => v !== null);
  return {
    closed: closed.length,
    followed: touched.filter((t) => adherence(t).score >= PLAN_FOLLOWED_AT).length,
    touched: touched.length,
    meanR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
  };
}

export function weeklyReview(x: WeeklyInputs): Brief {
  const start = addDays(x.weekEnding, -6);
  const inWeek = (d: string | null) => d !== null && d >= start && d <= x.weekEnding;
  const closed = x.trades.filter((t) => inWeek(t.exitDate));
  const opened = x.trades.filter((t) => inWeek(t.entryDate));
  const touched = x.trades.filter((t) => inWeek(t.entryDate) || inWeek(t.exitDate));
  const total = closed.reduce((a, t) => a + (pnl(t) ?? 0), 0);
  const rs = closed.map(rMultiple).filter((v): v is number => v !== null);
  const wins = closed.filter((t) => (pnl(t) ?? 0) > 0).length;
  const adh = touched.map((t) => adherence(t));
  const meanAdh = adh.length ? adh.reduce((a, b) => a + b.score, 0) / adh.length : null;
  const broken = new Map<string, number>();
  for (const a of adh) for (const b of a.broken) broken.set(b, (broken.get(b) ?? 0) + 1);
  const brokenList = [...broken.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const decisions = new Map<string, number>();
  for (const a of x.alerts) decisions.set(a.decision, (decisions.get(a.decision) ?? 0) + 1);
  const verdicts = new Map<string, number>();
  for (const f of x.feedback) verdicts.set(f.verdict, (verdicts.get(f.verdict) ?? 0) + 1);

  const sections: BriefSection[] = [
    {
      heading: 'Results',
      lines:
        closed.length === 0
          ? [`No trades closed this week; ${opened.length} opened.`]
          : [
              `${closed.length} trade${closed.length === 1 ? '' : 's'} closed, ${wins} winning: ${money(total)} realized.`,
              rs.length
                ? `Mean ${r1(rs.reduce((a, b) => a + b, 0) / rs.length)} over ${rs.length} trade${rs.length === 1 ? '' : 's'} with a stop.`
                : 'No closed trade had a stop, so no R.',
              `${opened.length} opened.`,
            ],
    },
    {
      heading: 'Behavior',
      lines:
        meanAdh === null
          ? ['No trades this week to score.']
          : [
              `Mean adherence ${toFixedHalfUp(meanAdh, 0)} over ${adh.length} trade${adh.length === 1 ? '' : 's'}.`,
              ...(brokenList.length === 0
                ? ['No rule broken.']
                : brokenList
                    .slice(0, 3)
                    .map(([b, n]) => `Broken ${n} time${n === 1 ? '' : 's'}: ${b}`)),
            ],
    },
    {
      heading: 'Alerts',
      lines: [
        x.alerts.length === 0
          ? 'No alerts this week.'
          : `${x.alerts.length} alert${x.alerts.length === 1 ? '' : 's'}: ${[...decisions.entries()]
              .sort()
              .map(([d, n]) => `${n} ${d}`)
              .join(', ')}.`,
        x.feedback.length === 0
          ? 'No feedback given.'
          : `Feedback: ${[...verdicts.entries()]
              .sort()
              .map(([v, n]) => `${n} ${v}`)
              .join(', ')}.`,
      ],
    },
    {
      heading: 'Rules (5 sessions)',
      lines:
        x.scorecard.length === 0
          ? ['No scored alerts yet.']
          : x.scorecard.map(
              (r) =>
                `${r.ruleId} (${r.status}): n=${r.n}${r.insufficient ? ', insufficient history' : `, win rate ${toFixedHalfUp((r.winRate ?? 0) * 100, 1)}%`}.`,
            ),
    },
    {
      heading: 'Market',
      lines: [x.regime ? `Regime at the week's end: ${x.regime}.` : 'No regime computed.'],
    },
    {
      heading: 'About this review',
      lines: [
        'Written from templates; every number comes from your journal, alerts and scorecard. An AI review arrives once an Anthropic key and caps are set.',
      ],
    },
  ];
  const brokenCount = [...broken.values()].reduce((a, b) => a + b, 0);
  const push = `${closed.length} closed, ${money(total)}; ${meanAdh === null ? 'no trades scored' : `adherence ${toFixedHalfUp(meanAdh, 0)}`}; ${brokenCount} rule break${brokenCount === 1 ? '' : 's'}.`;
  return {
    kind: 'weekly-review',
    date: x.weekEnding,
    version: WEEKLY_REVIEW_VERSION,
    title: `Weekly review, week ending ${x.weekEnding}`.slice(0, 60),
    pushBody: push.slice(0, 140),
    sections,
  };
}
