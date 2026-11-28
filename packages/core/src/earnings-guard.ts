/**
 * Earnings guard (ADR 0048 batch 5, ADR 0052; formula `earnings-guard-1`): a factual notice when a holding's next
 * results date falls within 5 trading sessions of the last completed session. It states the date and its source,
 * the sessions left, the shares held, the stop and its distance from the close, and whether exit rules are set.
 * It never says what to do: the text is facts only.
 *
 * The scan turns stored inputs into one snapshot per holding in the window; the alert is computed from the snapshot
 * alone, and the snapshot is stored inside the alert input, so replay (`earningsGuardAlert` on the stored snapshot)
 * reproduces the stored alert exactly. Pure.
 */
import type { AlertInput, Reading } from './alerts.js';
import { toFixedHalfUp } from './ai/template.js';
import { tradingSessionsBetween, type MarketCalendar } from './calendar.js';
import type { HoldingRef } from './exit-alerts.js';
import { fallToStop, hasExitRules } from './portfolio.js';
import { formatClock, US_EASTERN } from './time.js';
import { nextResultsDate, type ResultsDateSource } from './ticker-summary.js';

export const EARNINGS_GUARD_VERSION = 'earnings-guard-1';
export const EARNINGS_GUARD_RULE = 'earnings-guard';
export const EARNINGS_GUARD_RULE_VERSION = 1;
/** The window: an alert when the results date is at most this many trading sessions after the last completed one. */
export const EARNINGS_GUARD_SESSIONS = 5;
/**
 * Oldest a results date's source may be: Tauric's calendar refresh time or the estimate's computing time. Results
 * dates are set weeks ahead and change rarely, so a week; an older source is named and the run fails instead.
 */
export const EARNINGS_DATE_MAX_AGE_SECONDS = 7 * 86_400;
/** How far back earlier guard alerts are read, to dedupe and to find a moved date. Quarters are about 91 days apart. */
export const EARNINGS_GUARD_LOOKBACK_DAYS = 30;

/** The stored results-date inputs of one ticker. */
export interface EarningsDateInputs {
  /** Tauric's stated date and the calendar's as-of time (null when Tauric gives no time). */
  tauric: { date: string; asOf: string | null } | null;
  /** Marsad's `calendar-1` estimate, its window and when it was computed. */
  estimate: { date: string; from: string; to: string; computedAt: string } | null;
}

/** The close of the last completed session for one ticker, and when the bars job stored it. */
export interface GuardClose {
  date: string;
  close: number;
  fetchedAt: string;
}

/** An earlier guard alert, as stored. */
export interface PriorGuardAlert {
  alertId: string;
  holdingId: number;
  date: string;
  createdAt: string;
}

/** Everything one alert is computed from. Stored in the alert input, so replay needs nothing else. */
export interface EarningsGuardSnapshot {
  version: typeof EARNINGS_GUARD_VERSION;
  /** When the job ran (UTC); input ages are measured from it. */
  at: string;
  /** The last completed session (ET date); sessions are counted after it. */
  session: string;
  holding: {
    id: number;
    ticker: string;
    shares: number;
    stop: number | null;
    hasExitRules: boolean;
  };
  earnings: {
    date: string;
    source: ResultsDateSource;
    asOf: string;
    /** The estimate's window; null for Tauric's stated date. */
    window: { from: string; to: string } | null;
  };
  /** Market-closed weekdays (vendor holiday table) after the session up to the results date. */
  closedDays: string[];
  /** Last date the holiday table covers; later dates are counted as regular days. */
  calendarCoveredThrough: string | null;
  /** The close of `session`; null when it is not stored. */
  close: GuardClose | null;
  /** The newest earlier alert for this holding with a different date (the date moved), or null. */
  previous: { alertId: string; date: string; createdAt: string } | null;
}

/** One alert candidate, computed from a snapshot. */
export interface EarningsGuardCandidate {
  holdingId: number;
  ticker: string;
  earningsDate: string;
  source: ResultsDateSource;
  estimated: boolean;
  sessionsUntil: number;
  shares: number;
  stop: number | null;
  close: number | null;
  /** (close - stop) / close: positive when the stop is below the close. Null without a stop or a close. */
  stopDistance: number | null;
  hasExitRules: boolean;
  previous: EarningsGuardSnapshot['previous'];
}

export interface EarningsGuardScan {
  /** One per holding whose results date is in the window and not alerted yet. */
  snapshots: EarningsGuardSnapshot[];
  /** Tickers with no stored results date after the session (reported in the job summary, not alerted). */
  noDate: string[];
  /** Holdings whose date is in the window but already alerted (same holding, same date). */
  deduped: string[];
  /** Holdings with a date beyond the window. */
  later: number;
  /** Holdings whose results-date source is too old or has no as-of time; named, and the run fails. */
  stale: string[];
}

/** The event id of one holding's alert for one results date: the dedupe key's last part. */
export const earningsGuardEventId = (holdingId: number, date: string): string =>
  `earnings:${holdingId}:${date}`;

/** The holding id and date of a stored guard event id, or null when it is not one. */
export function parseEarningsGuardEventId(id: string): { holdingId: number; date: string } | null {
  const m = /^earnings:(\d+):(\d{4}-\d{2}-\d{2})$/.exec(id);
  return m ? { holdingId: Number(m[1]), date: m[2] as string } : null;
}

const ageSeconds = (at: string, asOf: string) =>
  Math.max(0, Math.round((Date.parse(at) - Date.parse(asOf)) / 1000));

/**
 * Every open holding against its next results date. The date comes from `nextResultsDate` (Tauric first, then
 * Marsad's estimate), the count from the trading calendar. `closes` holds each ticker's close of `session`, or null.
 */
export function earningsGuardScan(x: {
  at: Date;
  session: string;
  calendar: MarketCalendar;
  holdings: readonly HoldingRef[];
  dates: Readonly<Record<string, EarningsDateInputs | undefined>>;
  closes: Readonly<Record<string, GuardClose | null | undefined>>;
  prior: readonly PriorGuardAlert[];
}): EarningsGuardScan {
  const at = x.at.toISOString();
  const out: EarningsGuardScan = { snapshots: [], noDate: [], deduped: [], later: 0, stale: [] };
  for (const h of x.holdings) {
    const d = x.dates[h.ticker];
    const next = nextResultsDate(d?.tauric?.date ?? null, d?.estimate?.date ?? null, x.session);
    if (next === null) {
      out.noDate.push(h.ticker);
      continue;
    }
    if (tradingSessionsBetween(x.session, next.date, x.calendar) > EARNINGS_GUARD_SESSIONS) {
      out.later += 1;
      continue;
    }
    const asOf =
      next.source === 'tauric' ? (d?.tauric?.asOf ?? null) : (d?.estimate?.computedAt ?? null);
    const label = next.source === 'tauric' ? 'Tauric calendar' : 'Marsad estimate';
    if (asOf === null) {
      out.stale.push(`${h.ticker}: ${label} has no as-of time`);
      continue;
    }
    if (ageSeconds(at, asOf) > EARNINGS_DATE_MAX_AGE_SECONDS) {
      out.stale.push(`${h.ticker}: ${label} as of ${asOf}, older than 7 days`);
      continue;
    }
    const mine = x.prior.filter((p) => p.holdingId === h.id);
    if (mine.some((p) => p.date === next.date)) {
      out.deduped.push(h.ticker);
      continue;
    }
    const moved = [...mine]
      .filter((p) => p.date !== next.date)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const closedDays = [...x.calendar.specialDays.values()]
      .filter((s) => s.kind === 'closed' && s.date > x.session && s.date <= next.date)
      .map((s) => s.date)
      .sort();
    const close = x.closes[h.ticker] ?? null;
    out.snapshots.push({
      version: EARNINGS_GUARD_VERSION,
      at,
      session: x.session,
      holding: {
        id: h.id,
        ticker: h.ticker,
        shares: h.shares,
        stop: h.stop,
        hasExitRules: hasExitRules(h),
      },
      earnings: {
        date: next.date,
        source: next.source,
        asOf,
        window:
          next.source === 'marsad-estimate' && d?.estimate
            ? { from: d.estimate.from, to: d.estimate.to }
            : null,
      },
      closedDays,
      calendarCoveredThrough: x.calendar.coveredThrough,
      close: close !== null && close.date === x.session ? close : null,
      previous: moved
        ? { alertId: moved.alertId, date: moved.date, createdAt: moved.createdAt }
        : null,
    });
  }
  return out;
}

/** A calendar holding only the snapshot's closed days: enough to count the sessions again on replay. */
function snapshotCalendar(s: EarningsGuardSnapshot): MarketCalendar {
  return {
    exchange: 'NYSE',
    specialDays: new Map(
      s.closedDays.map((date) => [
        date,
        { date, name: 'closed', kind: 'closed' as const, open: null, close: null },
      ]),
    ),
    coveredThrough: s.calendarCoveredThrough,
  };
}

/** The candidate a snapshot describes: the sessions are counted again from its own closed days. */
export function earningsGuardCandidate(s: EarningsGuardSnapshot): EarningsGuardCandidate {
  const close = s.close?.close ?? null;
  const stop = s.holding.stop;
  return {
    holdingId: s.holding.id,
    ticker: s.holding.ticker,
    earningsDate: s.earnings.date,
    source: s.earnings.source,
    estimated: s.earnings.source === 'marsad-estimate',
    sessionsUntil: tradingSessionsBetween(s.session, s.earnings.date, snapshotCalendar(s)),
    shares: s.holding.shares,
    stop,
    close,
    stopDistance: close !== null && stop !== null ? fallToStop(close, stop) : null,
    hasExitRules: s.holding.hasExitRules,
    previous: s.previous,
  };
}

const sessionsText = (n: number) =>
  n === 0 ? 'before the next session' : `in ${n} session${n === 1 ? '' : 's'}`;

const sharesText = (n: number) => `${n} share${n === 1 ? '' : 's'}`;

/** "2026-11-26 11:45 UTC (06:45 ET)". */
const instantText = (iso: string) => {
  const d = new Date(iso);
  return `${iso.slice(0, 10)} ${formatClock(d, 'UTC')} UTC (${formatClock(d, US_EASTERN)} ET)`;
};

/** The facts-only text: date and source, sessions left, shares, stop and its distance, exit rules, a moved date. */
export function earningsGuardText(s: EarningsGuardSnapshot): { headline: string; trigger: string } {
  const c = earningsGuardCandidate(s);
  const source = c.estimated
    ? `Marsad estimate ${c.earningsDate}, estimated from past results filings${s.earnings.window ? `, window ${s.earnings.window.from} to ${s.earnings.window.to}` : ''}`
    : `Tauric date ${c.earningsDate}`;
  let stop: string;
  if (c.stop === null) stop = 'no stop set';
  else if (c.stopDistance === null)
    stop = `stop ${toFixedHalfUp(c.stop, 2)}; distance unavailable (no close stored for ${s.session})`;
  else if (c.stopDistance === 0) stop = `stop ${toFixedHalfUp(c.stop, 2)}, at the close`;
  else
    stop = `stop ${toFixedHalfUp(c.stop, 2)}, ${toFixedHalfUp(Math.abs(c.stopDistance) * 100, 1)}% ${c.stopDistance > 0 ? 'below' : 'above'} the close`;
  const parts = [
    `${c.ticker} reports ${sessionsText(c.sessionsUntil)} (${source}).`,
    `You hold ${sharesText(c.shares)}; ${stop}; ${c.hasExitRules ? 'exit rules set' : 'no exit rules set'}.`,
  ];
  if (c.previous)
    parts.push(
      `Date changed: the alert of ${instantText(c.previous.createdAt)} gave ${c.previous.date}.`,
    );
  if (s.calendarCoveredThrough === null || c.earningsDate > s.calendarCoveredThrough)
    parts.push(
      `The holiday table covers through ${s.calendarCoveredThrough ?? 'no date'}; the count assumes no other market holidays.`,
    );
  return {
    headline: `${c.ticker} reports ${sessionsText(c.sessionsUntil)}${c.estimated ? ' (estimated date)' : ''}`,
    trigger: parts.join(' '),
  };
}

const BEAR =
  'A results release can move the price through the stop in one gap: a stop order fills at the next traded price, not at the stop level, so the loss can be larger than the distance to the stop.';
const BEAR_ESTIMATE =
  ' The date is Marsad’s estimate from past filings, not a company announcement; the release can fall anywhere in the window.';

/**
 * The alert input for one snapshot, through the shared pipeline (`alerts-1`). A factual calendar notice: kind
 * `earnings`, normal priority, rule `earnings-guard` v1 live (it makes no directional call, so there is nothing to
 * backtest; ADR 0052). The snapshot rides along in the input; calling this again on the stored snapshot and context
 * reproduces the stored input.
 */
export function earningsGuardAlert(
  s: EarningsGuardSnapshot,
  context: { vix?: Reading; regime?: string },
): AlertInput {
  const c = earningsGuardCandidate(s);
  const { headline, trigger } = earningsGuardText(s);
  const sources: AlertInput['sources'] = [
    c.estimated
      ? {
          id: 'marsad-earnings-estimate',
          label: `Marsad results-date estimate (calendar-1, from SEC 8-K item 2.02 dates), ${c.earningsDate}`,
          asOf: s.earnings.asOf,
        }
      : {
          id: 'tauric-calendar',
          label: `Tauric calendar (company_research), earnings date ${c.earningsDate} (US Eastern date)`,
          asOf: s.earnings.asOf,
        },
  ];
  if (s.close)
    sources.push({
      id: 'massive-daily-bars',
      label: `Massive daily bars, completed session ${s.close.date} (end of day)`,
      asOf: s.close.fetchedAt,
    });
  const worst = Math.max(...sources.map((x) => ageSeconds(s.at, x.asOf)));
  return {
    kind: 'earnings',
    priority: 'normal',
    ticker: c.ticker,
    ruleId: EARNINGS_GUARD_RULE,
    ruleVersion: EARNINGS_GUARD_RULE_VERSION,
    ruleStatus: 'live',
    eventId: earningsGuardEventId(c.holdingId, c.earningsDate),
    headline,
    trigger,
    ...(c.close !== null ? { price: c.close } : {}),
    risk: [
      { horizon: 'scalp', losses: 0, n: null },
      { horizon: 'swing', losses: 0, n: null },
      { horizon: 'long', losses: 0, n: null },
    ],
    context: { ...context, news: [] },
    bearCase: c.estimated ? BEAR + BEAR_ESTIMATE : BEAR,
    sources,
    worstAgeSeconds: worst,
    // The scan already refused sources older than a week; bars are end of day.
    maxAgeSeconds: EARNINGS_DATE_MAX_AGE_SECONDS,
    delayed: true,
    snapshot: s,
  };
}

/** Whether a stored input's snapshot is an `earnings-guard-1` snapshot (shape checked, values trusted as stored). */
export function isEarningsGuardSnapshot(v: unknown): v is EarningsGuardSnapshot {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Partial<EarningsGuardSnapshot>;
  return (
    o.version === EARNINGS_GUARD_VERSION &&
    typeof o.at === 'string' &&
    typeof o.session === 'string' &&
    typeof o.holding?.ticker === 'string' &&
    typeof o.earnings?.date === 'string' &&
    Array.isArray(o.closedDays)
  );
}

/**
 * Replay (integrity rule 12): the alert input recomputed from a stored input's own snapshot and context, or null
 * when the input carries no guard snapshot. Equal to the stored input when the formula is unchanged.
 */
export function replayEarningsGuard(stored: AlertInput): AlertInput | null {
  if (!isEarningsGuardSnapshot(stored.snapshot)) return null;
  const { vix, regime } = stored.context;
  return earningsGuardAlert(stored.snapshot, {
    ...(vix ? { vix } : {}),
    ...(regime !== undefined ? { regime } : {}),
  });
}
