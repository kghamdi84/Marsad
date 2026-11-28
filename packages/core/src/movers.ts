/**
 * Whole-market movers (`movers-1`, ADR 0049): gainers, losers, most active, unusual volume and new 52-week highs and
 * lows for one stored session of Massive's grouped daily, over common stocks and ETFs only. End-of-day data, never
 * live. Pure: the inputs are aligned, split-adjusted daily series (the breadth job's), the eligible tickers and the
 * known splits and ticker changes.
 *
 * Integrity (CLAUDE.md rules 1, 6 and 10):
 * - A bad print (zero price, or no previous close stored) is counted and left out of every list.
 * - A move above 25%, or a move or volume jump that lines up with a split or ticker change Marsad knows about, is
 *   listed under "Check corporate action" and never ranked as a plain mover.
 * - A view without the history it needs is marked unavailable with how many sessions are stored and needed.
 */
import type { ShareChange, TickerSeries } from './breadth.js';

export const MOVERS_VERSION = 'movers-1';

/** Unusual volume: the session's volume over the average of the previous `sessions` sessions. One constant. */
export const UNUSUAL_VOLUME = Object.freeze({
  sessions: 20,
  /** The session's volume must be at least this many times the average. */
  minRatio: 3,
  /** And the session must trade at least this much (USD), so a thin name cannot qualify on a few trades. */
  minDollarVolume: 5_000_000,
});

/**
 * Liquidity floor: a ticker below either minimum is left out of every list (counted, not ranked). One constant.
 * The dollar-volume minimum is above the storage floor of `market_snapshots` (USD 1 million, MIN_SNAPSHOT_DOLLAR_VOLUME
 * in jobs/src/snapshot-codec.ts), so every ticker that passes is stored.
 */
export const LIQUIDITY_FLOOR = Object.freeze({
  /** Close in USD. */
  minPrice: 1,
  /** Close times volume in USD. */
  minDollarVolume: 2_000_000,
});

/** The longer volume average shown beside the 20-session ratio (information only; the rule uses 20). */
export const LONG_VOLUME_SESSIONS = 50;

export const MOVERS_RULES = Object.freeze({
  /** CLAUDE.md rule 6: a one-session move larger than this is checked against corporate actions, not ranked. */
  corporateActionMove: 0.25,
  unusual: UNUSUAL_VOLUME,
  liquidity: LIQUIDITY_FLOOR,
  /** A new high or low is the highest or lowest close of this many sessions, today included (as in breadth-1). */
  highLowSessions: 252,
  /** Rows kept per list (ranked rows and check rows each). */
  rows: 15,
  /** Minimum dollar-volume filter choices (USD). The first is the liquidity floor. */
  dollarVolumeFloors: Object.freeze([2_000_000, 10_000_000, 100_000_000, 1_000_000_000]),
});

export const MOVER_VIEWS = ['gainers', 'losers', 'active', 'unusual', 'highs', 'lows'] as const;
export type MoverView = (typeof MOVER_VIEWS)[number];

export type CheckReason =
  | 'move-over-25'
  | 'split-on-session'
  | 'split-in-volume-window'
  | 'ticker-change-on-session'
  | 'ticker-change-in-volume-window';

/** A ticker change Marsad knows about: `ticker` is the symbol in use from `date`. */
export interface TickerChange {
  ticker: string;
  date: string;
}

export interface MoverRow {
  ticker: string;
  /** Split-adjusted close of the session. */
  close: number;
  /** Close over the previous session's close, minus 1. */
  change: number;
  volume: number;
  /** Close times volume. */
  dollarVolume: number;
  /** Volume over the average of the previous 20 sessions; null without all 20 stored. */
  volumeRatio: number | null;
  /** Volume over the average of the previous 50 sessions; null without all 50 stored. Shown, never ranked on. */
  volumeRatio50: number | null;
  /** In the 52-week views: the highest (or lowest) close of the 251 sessions before. */
  prior?: number;
  /** On check rows only: why the row needs a corporate-action check. */
  check?: CheckReason[];
  /** On check rows that line up with a split: the newest such split. */
  split?: { date: string; from: number; to: number };
}

export type MoverViewResult =
  | {
      available: true;
      rows: MoverRow[];
      /** Unflagged tickers that qualify (the list shows the first `rows`). */
      qualified: number;
      checks: MoverRow[];
      checksQualified: number;
    }
  | { available: false; reason: 'history'; have: number; need: number };

export interface MoversFloor {
  minDollarVolume: number;
  views: Record<MoverView, MoverViewResult>;
}

export interface MoversSession {
  version: string;
  date: string;
  previousDate: string | null;
  /** Stored sessions up to and including this one. */
  sessions: number;
  /** The ticker list (common stocks and ETFs) used, by its as-of date; null when none was given. */
  eligibleAsOf: string | null;
  /** Eligible tickers that traded this session (stored, so at least the storage floor). */
  traded: number;
  /** Of those, with a usable change and above the liquidity floor: the base of every list. */
  withChange: number;
  /** Left out of every list. `samples` lists up to 10 tickers, alphabetically. */
  badPrints: { zeroPrice: number; noPreviousClose: number; samples: string[] };
  /** Left out of every list: under the minimum price, or (at or above it) under the minimum dollar volume. */
  belowLiquidity: { price: number; dollarVolume: number };
  /** Tickers with all 20 previous sessions stored (the unusual-volume base). */
  withVolumeHistory: number;
  /** Tickers with all 252 sessions stored (the 52-week base). */
  withYearHistory: number;
  rules: {
    corporateActionMove: number;
    unusual: { sessions: number; minRatio: number; minDollarVolume: number };
    liquidity: { minPrice: number; minDollarVolume: number };
    longVolumeSessions: number;
    highLowSessions: number;
    rows: number;
  };
  floors: MoversFloor[];
}

export interface MoversInput {
  /** Stored session dates, oldest first (closed days left out). */
  dates: readonly string[];
  /** Split-adjusted closes and volumes aligned to `dates`; null where not stored. */
  series: ReadonlyMap<string, TickerSeries>;
  /** Common stocks and ETFs. */
  eligible: ReadonlySet<string>;
  eligibleAsOf?: string | null;
  splits: readonly ShareChange[];
  tickerChanges?: readonly TickerChange[];
  /** The session to compute. */
  i: number;
}

interface Candidate extends MoverRow {
  flagAll: CheckReason[];
  flagVolume: CheckReason[];
  newHigh: number | null;
  newLow: number | null;
}

const ok = (x: number | null | undefined): x is number =>
  x !== null && x !== undefined && Number.isFinite(x);

/** The movers of session `i`. Ties break by ticker. */
export function moversSession(input: MoversInput): MoversSession {
  const { dates, series, eligible, splits, i } = input;
  const R = MOVERS_RULES;
  const U = R.unusual;
  const N = R.highLowSessions;
  const date = dates[i] as string;
  const prevDate = i > 0 ? (dates[i - 1] as string) : null;
  const volFrom = i - U.sessions >= 0 ? (dates[i - U.sessions] as string) : null;

  const splitsBy = new Map<string, ShareChange[]>();
  for (const s of splits) splitsBy.set(s.ticker, [...(splitsBy.get(s.ticker) ?? []), s]);
  const changesBy = new Map<string, string[]>();
  for (const c of input.tickerChanges ?? [])
    changesBy.set(c.ticker, [...(changesBy.get(c.ticker) ?? []), c.date]);

  // An event "lines up" with a span when it takes effect after the span's first session and on or before its last.
  const within = (d: string, from: string | null) => (from === null || d > from) && d <= date;

  const bad = { zeroPrice: 0, noPreviousClose: 0, samples: [] as string[] };
  const badList: string[] = [];
  const cands: Candidate[] = [];
  let traded = 0;
  let withVolumeHistory = 0;
  let withYearHistory = 0;
  const below = { price: 0, dollarVolume: 0 };
  const ratioOver = (vol: readonly (number | null)[], v: number, n: number): number | null => {
    if (i - n < 0) return null;
    let sum = 0;
    for (let k = i - n; k < i; k++) {
      const x = vol[k];
      if (!ok(x)) return null;
      sum += x;
    }
    return sum > 0 ? v / (sum / n) : null;
  };

  for (const [ticker, s] of series) {
    if (!eligible.has(ticker)) continue;
    const c = s.close[i];
    const v = s.volume[i];
    if (c === null || c === undefined) continue; // not stored this session
    traded += 1;
    const p = i > 0 ? s.close[i - 1] : null;
    if (!ok(c) || c <= 0 || !ok(v) || v < 0 || (ok(p) && p <= 0)) {
      bad.zeroPrice += 1;
      badList.push(ticker);
      continue;
    }
    if (!ok(p)) {
      bad.noPreviousClose += 1;
      badList.push(ticker);
      continue;
    }
    const change = c / p - 1;
    if (c < R.liquidity.minPrice) {
      below.price += 1;
      continue;
    }
    if (c * v < R.liquidity.minDollarVolume) {
      below.dollarVolume += 1;
      continue;
    }

    const volumeRatio = ratioOver(s.volume, v, U.sessions);
    if (volumeRatio !== null) withVolumeHistory += 1;
    const volumeRatio50 = ratioOver(s.volume, v, LONG_VOLUME_SESSIONS);

    let newHigh: number | null = null;
    let newLow: number | null = null;
    if (i - N + 1 >= 0) {
      let hi = -Infinity;
      let lo = Infinity;
      let full = true;
      for (let k = i - N + 1; k < i; k++) {
        const x = s.close[k];
        if (!ok(x)) {
          full = false;
          break;
        }
        if (x > hi) hi = x;
        if (x < lo) lo = x;
      }
      if (full) {
        withYearHistory += 1;
        if (c >= hi) newHigh = hi;
        if (c <= lo) newLow = lo;
      }
    }

    const flagAll: CheckReason[] = [];
    const flagVolume: CheckReason[] = [];
    if (Math.abs(change) > R.corporateActionMove) flagAll.push('move-over-25');
    const sp = splitsBy.get(ticker) ?? [];
    const spToday = sp.filter((x) => within(x.executionDate, prevDate));
    const spWindow = sp.filter((x) => within(x.executionDate, volFrom));
    if (spToday.length > 0) flagAll.push('split-on-session');
    else if (spWindow.length > 0) flagVolume.push('split-in-volume-window');
    const tc = changesBy.get(ticker) ?? [];
    if (tc.some((d) => within(d, prevDate))) flagAll.push('ticker-change-on-session');
    else if (tc.some((d) => within(d, volFrom))) flagVolume.push('ticker-change-in-volume-window');
    const newest = [...spWindow].sort((a, b) => b.executionDate.localeCompare(a.executionDate))[0];

    cands.push({
      ticker,
      close: c,
      change,
      volume: v,
      dollarVolume: c * v,
      volumeRatio,
      volumeRatio50,
      flagAll,
      flagVolume,
      newHigh,
      newLow,
      ...(newest
        ? { split: { date: newest.executionDate, from: newest.splitFrom, to: newest.splitTo } }
        : {}),
    });
  }
  bad.samples = badList.sort().slice(0, 10);

  const unavailable = (have: number, need: number): MoverViewResult => ({
    available: false,
    reason: 'history',
    have,
    need,
  });
  const byTicker = (a: Candidate, b: Candidate) => a.ticker.localeCompare(b.ticker);
  const specs: Record<
    MoverView,
    {
      need: number;
      qualifies: (x: Candidate, floor: number) => boolean;
      order: (a: Candidate, b: Candidate) => number;
      flags: (x: Candidate) => CheckReason[];
      prior?: (x: Candidate) => number | null;
    }
  > = {
    gainers: {
      need: 2,
      qualifies: (x) => x.change > 0,
      order: (a, b) => b.change - a.change || byTicker(a, b),
      flags: (x) => x.flagAll,
    },
    losers: {
      need: 2,
      qualifies: (x) => x.change < 0,
      order: (a, b) => a.change - b.change || byTicker(a, b),
      flags: (x) => x.flagAll,
    },
    active: {
      need: 1,
      qualifies: () => true,
      order: (a, b) => b.dollarVolume - a.dollarVolume || byTicker(a, b),
      flags: (x) => x.flagAll,
    },
    unusual: {
      need: U.sessions + 1,
      qualifies: (x, floor) =>
        x.volumeRatio !== null &&
        x.volumeRatio >= U.minRatio &&
        x.dollarVolume >= Math.max(floor, U.minDollarVolume),
      order: (a, b) => (b.volumeRatio ?? 0) - (a.volumeRatio ?? 0) || byTicker(a, b),
      flags: (x) => [...x.flagAll, ...x.flagVolume],
    },
    highs: {
      need: N,
      qualifies: (x) => x.newHigh !== null,
      order: (a, b) => b.change - a.change || byTicker(a, b),
      flags: (x) => x.flagAll,
      prior: (x) => x.newHigh,
    },
    lows: {
      need: N,
      qualifies: (x) => x.newLow !== null,
      order: (a, b) => a.change - b.change || byTicker(a, b),
      flags: (x) => x.flagAll,
      prior: (x) => x.newLow,
    },
  };

  const row = (
    x: Candidate,
    prior: number | null | undefined,
    check?: CheckReason[],
  ): MoverRow => ({
    ticker: x.ticker,
    close: x.close,
    change: x.change,
    volume: x.volume,
    dollarVolume: x.dollarVolume,
    volumeRatio: x.volumeRatio,
    volumeRatio50: x.volumeRatio50,
    ...(prior !== null && prior !== undefined ? { prior } : {}),
    ...(check ? { check } : {}),
    ...(check && x.split && check.some((r) => r.startsWith('split')) ? { split: x.split } : {}),
  });

  const floors: MoversFloor[] = R.dollarVolumeFloors.map((floor) => {
    const views = {} as Record<MoverView, MoverViewResult>;
    for (const view of MOVER_VIEWS) {
      const spec = specs[view];
      if (i + 1 < spec.need) {
        views[view] = unavailable(i + 1, spec.need);
        continue;
      }
      const q = cands
        .filter((x) => x.dollarVolume >= floor && spec.qualifies(x, floor))
        .sort(spec.order);
      const plain = q.filter((x) => spec.flags(x).length === 0);
      const flagged = q.filter((x) => spec.flags(x).length > 0);
      views[view] = {
        available: true,
        rows: plain.slice(0, R.rows).map((x) => row(x, spec.prior?.(x))),
        qualified: plain.length,
        checks: flagged.slice(0, R.rows).map((x) => row(x, spec.prior?.(x), spec.flags(x))),
        checksQualified: flagged.length,
      };
    }
    return { minDollarVolume: floor, views };
  });

  return {
    version: MOVERS_VERSION,
    date,
    previousDate: prevDate,
    sessions: i + 1,
    eligibleAsOf: input.eligibleAsOf ?? null,
    traded,
    withChange: cands.length,
    badPrints: bad,
    belowLiquidity: below,
    withVolumeHistory,
    withYearHistory,
    rules: {
      corporateActionMove: R.corporateActionMove,
      unusual: { ...U },
      liquidity: { ...R.liquidity },
      longVolumeSessions: LONG_VOLUME_SESSIONS,
      highLowSessions: N,
      rows: R.rows,
    },
    floors,
  };
}
