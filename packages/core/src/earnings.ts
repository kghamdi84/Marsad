/**
 * Earnings history: what each quarter reported (from SEC filings) and how the stock moved in the session that
 * could first trade on the news. The release date is the SEC acceptance time of the 8-K that carries Item 2.02
 * (Results of Operations), never the 10-Q date, which can come weeks later. Estimates, surprise and guidance
 * need paid data and are not computed here.
 */
import { etDate, etWallToUtc } from './calendar.js';
import type { Metric, QuarterRow } from './fundamentals.js';
import { snapToBar, type DailyBar, type SplitEvent } from './study.js';

/** Version of the formulas behind the figures, shown with them (integrity rule 1). */
export const EARNINGS_VERSION = 'earnings-1';

/** A move above this size is flagged for a second look (integrity rule 6). */
export const LARGE_MOVE_PCT = 25;

/** The longest gap between two bars that is still "the previous session" (a long holiday weekend is 4 days). */
const MAX_BAR_GAP_DAYS = 5;

/**
 * A release is assigned to the latest quarter that ended before it, if that was at most this many days earlier.
 * Quarters end about 91 days apart and results come at least a week after the end, so a release more than 95
 * days after the newest known quarter end belongs to a quarter whose 10-Q or 10-K is not in the data yet.
 * A slower reporter than that is shown as having no matching release, never matched to the wrong quarter.
 */
export const MAX_RELEASE_LAG_DAYS = 95;

const DAY = 86_400_000;
const NONE: Metric = { value: null, filed: null, accession: null, derived: false };

export type ReleaseTiming = 'before-open' | 'during-session' | 'after-close';

export interface EarningsFiling {
  accession: string;
  form: string;
  filingDate: string;
  acceptedAt: string | null;
  items: readonly string[];
}

export interface EarningsRelease {
  accession: string;
  /** The ET date the SEC accepted the 8-K. */
  date: string;
  /** Null when the filing has no acceptance time, so the session cannot be known. */
  timing: ReleaseTiming | null;
}

export type MoveGap =
  | 'no-release' // no Item 2.02 8-K is stored for this quarter
  | 'no-time' // the 8-K has no acceptance time, so the session that reacted is unknown
  | 'outside-bars' // the release is before the first stored bar
  | 'not-yet' // the session that reacts has no bar yet
  | 'missing-bars' // the previous bar is too far back to be the previous session
  | 'split'; // a split falls in the window, so the two closes are not comparable without care

export interface EarningsMove {
  baseDate: string;
  baseClose: number;
  reactionDate: string;
  reactionClose: number;
  /** Percent change from the base close to the reaction close. */
  pct: number;
  /** True above LARGE_MOVE_PCT: checked for splits in the window, still worth a look. */
  large: boolean;
}

export interface EarningsRow {
  /** Null for a release whose results are not yet in a filed 10-Q or 10-K. */
  quarterEnd: string | null;
  revenue: Metric;
  epsDiluted: Metric;
  revenueYoYPct: number | null;
  release: EarningsRelease | null;
  move: EarningsMove | null;
  /** Why `move` is null. Null when there is a move. */
  moveGap: MoveGap | null;
}

export interface EarningsMoveSummary {
  /** Reports with a computed move. */
  n: number;
  up: number;
  down: number;
  unchanged: number;
  /** Average size of the move, ignoring direction. Null when n is 0. */
  meanAbsPct: number | null;
  /** True below 30 reports (rule 10). The page says so next to any figure drawn from it. */
  smallSample: boolean;
}

export interface EarningsHistory {
  formulaVersion: string;
  /** Oldest first. */
  rows: EarningsRow[];
  summary: EarningsMoveSummary;
}

const gapDays = (a: string, b: string): number =>
  (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY;

function timingOf(acceptedAt: string | null): ReleaseTiming | null {
  if (acceptedAt === null) return null;
  const t = new Date(acceptedAt);
  if (Number.isNaN(t.getTime())) return null;
  const day = etDate(t);
  if (t.getTime() >= etWallToUtc(day, 16, 0).getTime()) return 'after-close';
  if (t.getTime() < etWallToUtc(day, 9, 30).getTime()) return 'before-open';
  return 'during-session';
}

function releaseOf(f: EarningsFiling): EarningsRelease {
  const parsed = f.acceptedAt === null ? null : new Date(f.acceptedAt);
  const valid = parsed !== null && !Number.isNaN(parsed.getTime());
  return {
    accession: f.accession,
    date: valid ? etDate(parsed) : f.filingDate,
    timing: timingOf(f.acceptedAt),
  };
}

/**
 * The move in the first session that could trade on the news, from the close before it. A release before the
 * open or during the session reacts that day; one after the close reacts the next day. Bars must be ascending
 * and split-adjusted.
 */
export function earningsMove(
  filing: EarningsFiling,
  bars: readonly DailyBar[],
  splits: readonly SplitEvent[],
): { move: EarningsMove } | { gap: MoveGap } {
  const release = releaseOf(filing);
  if (release.timing === null) return { gap: 'no-time' };
  const dates = bars.map((b) => b.date);
  const first = dates[0];
  if (first === undefined || release.date < first) return { gap: 'outside-bars' };
  const reactionDate = snapToBar(dates, filing.acceptedAt, filing.filingDate);
  if (reactionDate === null) return { gap: 'not-yet' };
  const at = dates.indexOf(reactionDate);
  const base = bars[at - 1];
  const reaction = bars[at];
  if (at === 0 || base === undefined || reaction === undefined) return { gap: 'outside-bars' };
  if (gapDays(base.date, reaction.date) > MAX_BAR_GAP_DAYS) return { gap: 'missing-bars' };
  if (splits.some((s) => s.executionDate > base.date && s.executionDate <= reaction.date))
    return { gap: 'split' };
  if (base.close <= 0) return { gap: 'missing-bars' };
  const pct = ((reaction.close - base.close) / base.close) * 100;
  return {
    move: {
      baseDate: base.date,
      baseClose: base.close,
      reactionDate: reaction.date,
      reactionClose: reaction.close,
      pct,
      large: Math.abs(pct) > LARGE_MOVE_PCT,
    },
  };
}

export function summarizeMoves(rows: readonly EarningsRow[]): EarningsMoveSummary {
  const moves = rows.flatMap((r) => (r.move ? [r.move.pct] : []));
  const n = moves.length;
  return {
    n,
    up: moves.filter((m) => m > 0).length,
    down: moves.filter((m) => m < 0).length,
    unchanged: moves.filter((m) => m === 0).length,
    meanAbsPct: n === 0 ? null : moves.reduce((s, m) => s + Math.abs(m), 0) / n,
    smallSample: n < 30,
  };
}

/**
 * Joins the reported quarters to their earnings releases and measures each reaction. `quarters` come from
 * `summarizeFinancials`, so they already hold only what had been filed. A release belongs to the latest quarter
 * that ended before it (within MAX_RELEASE_LAG_DAYS); the earliest release wins and later Item 2.02 filings for
 * the same quarter are ignored. The filing date of a figure is not used: a prior-year quarter is repeated in
 * later filings and carries the later date. A release too long after the newest quarter belongs to a quarter
 * with no results in the data yet, so it is listed alone and the latest reaction is not hidden.
 */
export function buildEarningsHistory(input: {
  quarters: readonly QuarterRow[];
  filings: readonly EarningsFiling[];
  bars: readonly DailyBar[];
  splits: readonly SplitEvent[];
}): EarningsHistory {
  const { quarters, bars, splits } = input;
  const filingOf = new Map<string, EarningsFiling>();
  const instant = (f: EarningsFiling): number => {
    const t = Date.parse(f.acceptedAt ?? `${f.filingDate}T00:00:00Z`);
    return Number.isNaN(t) ? Date.parse(`${f.filingDate}T00:00:00Z`) : t;
  };
  // Earliest first by the moment the SEC accepted them, so the first release of a day wins over a later one.
  const releases = input.filings
    .filter((f) => f.form === '8-K' && f.items.includes('2.02'))
    .sort((a, b) => instant(a) - instant(b) || a.accession.localeCompare(b.accession))
    .map((f) => {
      filingOf.set(f.accession, f);
      return releaseOf(f);
    });
  const measure = (release: EarningsRelease | null) => {
    if (release === null) return { move: null, moveGap: 'no-release' as MoveGap };
    const r = earningsMove(filingOf.get(release.accession) as EarningsFiling, bars, splits);
    return 'move' in r ? { move: r.move, moveGap: null } : { move: null, moveGap: r.gap };
  };

  const ordered = [...quarters].sort((a, b) => a.end.localeCompare(b.end));
  const assigned = new Map<string, EarningsRelease>();
  const claimed = new Set<string>();
  for (const release of releases) {
    const q = [...ordered].reverse().find((x) => x.end < release.date);
    if (!q || gapDays(q.end, release.date) > MAX_RELEASE_LAG_DAYS) continue;
    claimed.add(release.accession);
    if (!assigned.has(q.end)) assigned.set(q.end, release);
  }

  const rows: EarningsRow[] = ordered.map((q) => {
    const release = assigned.get(q.end) ?? null;
    return {
      quarterEnd: q.end,
      revenue: q.revenue,
      epsDiluted: q.epsDiluted,
      revenueYoYPct: q.revenueYoYPct,
      release,
      ...measure(release),
    };
  });

  const newestEnd = ordered.at(-1)?.end ?? null;
  const pending = releases.find(
    (r) => !claimed.has(r.accession) && (newestEnd === null || r.date > newestEnd),
  );
  if (pending)
    rows.push({
      quarterEnd: null,
      revenue: NONE,
      epsDiluted: NONE,
      revenueYoYPct: null,
      release: pending,
      ...measure(pending),
    });

  return { formulaVersion: EARNINGS_VERSION, rows, summary: summarizeMoves(rows) };
}
