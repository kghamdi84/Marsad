/**
 * The weekly review (ADR 0029, `weekly-review-1`), written from templates: results and behavior side by side,
 * including where Khaled broke his own rules, the week's alerts and his feedback, and each rule's scorecard. Code
 * computes every number; when the AI layer is enabled it may add prose around the same numbers, verified against
 * this payload. Pure.
 */
import { toFixedHalfUp } from './ai/template.js';
import type { Fact } from './ai/facts.js';
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

/**
 * A fund's (or index's) return over the review week, close to close: the last close on or before `weekEnding`
 * against the last close before the week began (`weekEnding` minus 6 days). Null when either close is missing,
 * so a gap in the stored bars reads as unavailable, never as a flat week. Bars are oldest first.
 */
export function weekReturn(
  bars: readonly { date: string; close: number }[],
  weekEnding: string,
): { pct: number; from: string; to: string } | null {
  const start = addDays(weekEnding, -6);
  const end = [...bars].reverse().find((b) => b.date <= weekEnding);
  const base = [...bars].reverse().find((b) => b.date < start);
  if (!end || !base || end.date < start || !(base.close > 0)) return null;
  return { pct: end.close / base.close - 1, from: base.date, to: end.date };
}

export interface HeldWeek {
  /** Value change over value at the start, for holdings held the whole week; null when a close is missing. */
  pct: number | null;
  /** Holdings held from the start close to the end close. */
  held: number;
  /** Holdings bought or sold inside the week: left out, so cash moving in or out never reads as a return. */
  leftOut: number;
  /** Tickers without a stored close on the start or end session. */
  missing: string[];
}

/**
 * The portfolio's week for the weekly review (formula held-week-1): holdings held from the session `from` to the
 * session `to` (the SPY tile's two closes), valued at those closes. A holding opened after `from` or closed on or
 * before `to` is left out and counted. Any missing close makes the result unavailable, never a partial number.
 * Bars are split-adjusted, so a split inside the week does not show as a loss. Null without any holding in range.
 */
export function heldWeekReturn(
  holdings: readonly {
    ticker: string;
    shares: number;
    openedOn: string;
    closedOn: string | null;
  }[],
  bars: Readonly<Record<string, readonly { date: string; close: number }[]>>,
  from: string,
  to: string,
): HeldWeek | null {
  const inRange = holdings.filter(
    (h) => h.openedOn <= to && (h.closedOn === null || h.closedOn > from),
  );
  if (inRange.length === 0) return null;
  const held = inRange.filter(
    (h) => h.openedOn <= from && (h.closedOn === null || h.closedOn > to),
  );
  const missing: string[] = [];
  let base = 0;
  let end = 0;
  for (const h of held) {
    const b = bars[h.ticker] ?? [];
    const c0 = b.find((x) => x.date === from)?.close;
    const c1 = b.find((x) => x.date === to)?.close;
    if (c0 === undefined || c1 === undefined) {
      missing.push(h.ticker);
      continue;
    }
    base += h.shares * c0;
    end += h.shares * c1;
  }
  return {
    pct: held.length > 0 && missing.length === 0 && base > 0 ? end / base - 1 : null,
    held: held.length,
    leftOut: inRange.length - held.length,
    missing: [...new Set(missing)],
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
        'Written from templates; every number comes from your journal, alerts and scorecard. When the Anthropic key is set, Claude adds a short review in words from the same figures, checked against them.',
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

/**
 * The figures of the review as grounded facts (F1, F2, ...), for the AI prose (weekly-review@1): the same numbers
 * the template writes, computed the same way, so prose verified against them cannot say anything the template
 * does not. Facts that do not apply this week (no trades with a stop, no scored rules) are left out.
 */
export function weeklyReviewFacts(x: WeeklyInputs): Fact[] {
  const start = addDays(x.weekEnding, -6);
  const inWeek = (d: string | null) => d !== null && d >= start && d <= x.weekEnding;
  const closed = x.trades.filter((t) => inWeek(t.exitDate));
  const opened = x.trades.filter((t) => inWeek(t.entryDate));
  const touched = x.trades.filter((t) => inWeek(t.entryDate) || inWeek(t.exitDate));
  const rs = closed.map(rMultiple).filter((v): v is number => v !== null);
  const adh = touched.map((t) => adherence(t));
  const broken = new Map<string, number>();
  for (const a of adh) for (const b of a.broken) broken.set(b, (broken.get(b) ?? 0) + 1);
  const out: Omit<Fact, 'id'>[] = [
    { label: `Week ending ${x.weekEnding}: trades closed`, value: closed.length, unit: 'count' },
    { label: 'Trades opened this week', value: opened.length, unit: 'count' },
    {
      label: 'Closed trades that made money',
      value: closed.filter((t) => (pnl(t) ?? 0) > 0).length,
      unit: 'count',
    },
  ];
  if (closed.length > 0)
    out.push({
      label: 'Realized result of the closed trades',
      value: Math.round(closed.reduce((a, t) => a + (pnl(t) ?? 0), 0) * 100) / 100,
      unit: 'usd',
    });
  if (rs.length > 0) {
    out.push({
      label: 'Mean result in R of the closed trades with a stop',
      value: Math.round((rs.reduce((a, b) => a + b, 0) / rs.length) * 100) / 100,
      unit: 'ratio',
    });
    out.push({ label: 'Closed trades with a stop', value: rs.length, unit: 'count' });
  }
  if (adh.length > 0) {
    out.push({
      label: 'Mean plan adherence score, out of a hundred',
      value: Math.round(adh.reduce((a, b) => a + b.score, 0) / adh.length),
      unit: 'count',
    });
    out.push({ label: 'Trades scored for adherence', value: adh.length, unit: 'count' });
  }
  for (const [rule, n] of [...broken.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  ))
    out.push({ label: `Times this rule was broken: ${rule}`, value: n, unit: 'count' });
  out.push({ label: 'Alerts this week', value: x.alerts.length, unit: 'count' });
  out.push({
    label: 'Feedback given on alerts this week',
    value: x.feedback.length,
    unit: 'count',
  });
  for (const r of x.scorecard) {
    out.push({
      label: `Rule ${r.ruleId} (${r.status}): alerts scored at 5 sessions`,
      value: r.n,
      unit: 'count',
    });
    if (!r.insufficient && r.winRate !== null)
      out.push({
        label: `Rule ${r.ruleId}: share of alerts that worked at 5 sessions`,
        value: Math.round(r.winRate * 1000) / 10,
        unit: 'pct',
      });
  }
  out.push({
    label: "Market regime at the week's end",
    value: x.regime ?? 'not computed',
    unit: 'text',
  });
  return out.map((f, i) => ({
    id: `F${i + 1}`,
    source: 'Marsad journal, alerts and scorecard',
    ...f,
  }));
}
