/**
 * Marsad universe breadth (ADR 0010): the top 1,000 US common stocks and ETFs by 20-session dollar volume, rebuilt on
 * the first session of each month from data available before it, and the daily breadth of that universe. Always
 * labelled "Marsad universe breadth", never as official index breadth. Pure functions over aligned daily series.
 */
import { ema } from './indicators.js';

export const BREADTH_VERSION = 'breadth-1';
export const UNIVERSE_VERSION = 'universe-1';

export const BREADTH_RULES = Object.freeze({
  universeSize: 1000,
  rankSessions: 20,
  /** A ticker needs a price on at least this many of the 20 sessions to be ranked. */
  minRankSessions: 15,
  /** A one-day move larger than this (with no split) is treated as a bad print and left out that day. */
  suspectMove: 0.5,
  highLowSessions: 252,
  zweigWindow: 10,
  zweigLow: 0.4,
  zweigHigh: 0.615,
  mcclellanFast: 19,
  mcclellanSlow: 39,
});

/** One ticker's daily closes and volumes, aligned to a shared list of session dates; null where it did not trade. */
export interface TickerSeries {
  close: readonly (number | null)[];
  volume: readonly (number | null)[];
}

export interface UniverseMember {
  ticker: string;
  rank: number;
  /** Average close times volume over the sessions it traded in the 20 before the rebuild. */
  dollarVolume: number;
}

/**
 * The universe for the session at `at`: ranked on the 20 sessions before it (never on `at` itself), among
 * `eligible` tickers (common stocks and ETFs that existed then). Ties break by ticker so the result is stable.
 */
export function rankUniverse(
  series: ReadonlyMap<string, TickerSeries>,
  eligible: ReadonlySet<string>,
  at: number,
  size: number = BREADTH_RULES.universeSize,
): UniverseMember[] {
  const R = BREADTH_RULES;
  const from = at - R.rankSessions;
  if (from < 0) return [];
  const scored: { ticker: string; dollarVolume: number }[] = [];
  for (const [ticker, s] of series) {
    if (!eligible.has(ticker)) continue;
    let sum = 0;
    let n = 0;
    for (let i = from; i < at; i++) {
      const c = s.close[i];
      const v = s.volume[i];
      if (c === null || c === undefined || v === null || v === undefined) continue;
      sum += c * v;
      n += 1;
    }
    if (n >= R.minRankSessions) scored.push({ ticker, dollarVolume: sum / n });
  }
  scored.sort((a, b) => b.dollarVolume - a.dollarVolume || (a.ticker < b.ticker ? -1 : 1));
  return scored.slice(0, size).map((s, i) => ({ ...s, rank: i + 1 }));
}

/** Index of the first session of each month in `dates` (ascending ISO dates). */
export function monthStarts(dates: readonly string[]): number[] {
  const out: number[] = [];
  dates.forEach((d, i) => {
    if (i === 0 || d.slice(0, 7) !== (dates[i - 1] as string).slice(0, 7)) out.push(i);
  });
  return out;
}

export interface BreadthDay {
  date: string;
  version: string;
  /** Members of the universe that day, and how many of them had a usable price change. */
  members: number;
  withChange: number;
  advancers: number;
  decliners: number;
  unchanged: number;
  upVolume: number;
  downVolume: number;
  /** Above the 50- and 200-session average, out of the members with enough history for each. */
  above50: number;
  n50: number;
  above200: number;
  n200: number;
  /** Closing at a 252-session high or low, out of the members with 252 sessions. */
  newHighs: number;
  newLows: number;
  n252: number;
  /** Members left out that day because the move looked like a bad print (more than 50% with no split). */
  suspect: number;
}

/** The last `n` closes ending at `i`, or null when any is missing. */
function window(close: readonly (number | null)[], i: number, n: number): number[] | null {
  if (i - n + 1 < 0) return null;
  const out: number[] = [];
  for (let k = i - n + 1; k <= i; k++) {
    const c = close[k];
    if (c === null || c === undefined) return null;
    out.push(c);
  }
  return out;
}

/**
 * Breadth of the universe on session `i`. `members` are the tickers in that month's universe. A member with no
 * price that day, or no price the session before, is counted in `members` but not in the change statistics.
 */
export function breadthOn(
  dates: readonly string[],
  series: ReadonlyMap<string, TickerSeries>,
  members: readonly string[],
  i: number,
): BreadthDay {
  const R = BREADTH_RULES;
  const day: BreadthDay = {
    date: dates[i] as string,
    version: BREADTH_VERSION,
    members: members.length,
    withChange: 0,
    advancers: 0,
    decliners: 0,
    unchanged: 0,
    upVolume: 0,
    downVolume: 0,
    above50: 0,
    n50: 0,
    above200: 0,
    n200: 0,
    newHighs: 0,
    newLows: 0,
    n252: 0,
    suspect: 0,
  };
  for (const t of members) {
    const s = series.get(t);
    if (!s) continue;
    const c = s.close[i];
    const p = i > 0 ? s.close[i - 1] : null;
    if (c === null || c === undefined || p === null || p === undefined || p <= 0 || c <= 0)
      continue;
    if (Math.abs(c / p - 1) > R.suspectMove) {
      day.suspect += 1;
      continue;
    }
    const v = s.volume[i] ?? 0;
    day.withChange += 1;
    if (c > p) {
      day.advancers += 1;
      day.upVolume += v;
    } else if (c < p) {
      day.decliners += 1;
      day.downVolume += v;
    } else day.unchanged += 1;
    const w50 = window(s.close, i, 50);
    if (w50) {
      day.n50 += 1;
      if (c > w50.reduce((a, b) => a + b, 0) / 50) day.above50 += 1;
    }
    const w200 = window(s.close, i, 200);
    if (w200) {
      day.n200 += 1;
      if (c > w200.reduce((a, b) => a + b, 0) / 200) day.above200 += 1;
    }
    const w252 = window(s.close, i, R.highLowSessions);
    if (w252) {
      day.n252 += 1;
      if (c >= Math.max(...w252)) day.newHighs += 1;
      if (c <= Math.min(...w252)) day.newLows += 1;
    }
  }
  return day;
}

/** Share of members with a price change that advanced: advancers over (advancers plus decliners). */
export function advanceShare(d: BreadthDay): number | null {
  const n = d.advancers + d.decliners;
  return n === 0 ? null : d.advancers / n;
}

export interface BreadthSignals {
  date: string;
  /** 10-session average of the advance share. Null until 10 sessions have one. */
  advanceAvg10: number | null;
  /** True on the day a Zweig breadth thrust completes. */
  zweigThrust: boolean;
  /** Net up-volume ratio, (up - down) / (up + down). */
  volumeRatio: number | null;
  mcclellanOscillator: number | null;
  mcclellanSummation: number | null;
}

/**
 * Series-level signals. Zweig breadth thrust (as the brief defines it): the 10-session average of the advance share
 * rises from below 0.40 to above 0.615 within 10 sessions; it fires on the first day above 0.615. McClellan-style
 * volume oscillator: the 19- minus the 39-session exponential average of the net up-volume ratio; the summation
 * adds the oscillator up from the first day it exists.
 */
export function breadthSignals(days: readonly BreadthDay[]): BreadthSignals[] {
  const R = BREADTH_RULES;
  const share = days.map(advanceShare);
  const avg: (number | null)[] = share.map((_, i) => {
    if (i < R.zweigWindow - 1) return null;
    const w = share.slice(i - R.zweigWindow + 1, i + 1);
    if (w.some((x) => x === null)) return null;
    return (w as number[]).reduce((a, b) => a + b, 0) / R.zweigWindow;
  });
  const ratio = days.map((d) =>
    d.upVolume + d.downVolume > 0
      ? (d.upVolume - d.downVolume) / (d.upVolume + d.downVolume)
      : null,
  );
  // The exponential averages need an unbroken series: start them after the last missing ratio.
  const lastGap = ratio.reduce<number>((m, r, i) => (r === null ? i : m), -1);
  const tail = ratio.slice(lastGap + 1) as number[];
  const fast = ema(tail, R.mcclellanFast);
  const slow = ema(tail, R.mcclellanSlow);
  let sum = 0;
  let started = false;
  return days.map((d, i) => {
    const a = avg[i] ?? null;
    let thrust = false;
    if (a !== null && a > R.zweigHigh && !((avg[i - 1] ?? 0) > R.zweigHigh)) {
      for (let k = Math.max(0, i - R.zweigWindow); k < i; k++) {
        const v = avg[k];
        if (v !== null && v !== undefined && v < R.zweigLow) thrust = true;
      }
    }
    let osc: number | null = null;
    const j = i - (lastGap + 1);
    if (j >= 0) {
      const f = fast[j];
      const s = slow[j];
      if (f !== null && f !== undefined && s !== null && s !== undefined) osc = f - s;
    }
    if (osc !== null) {
      sum += osc;
      started = true;
    }
    return {
      date: d.date,
      advanceAvg10: a,
      zweigThrust: thrust,
      volumeRatio: ratio[i] ?? null,
      mcclellanOscillator: osc,
      mcclellanSummation: started ? sum : null,
    };
  });
}

export interface BreadthHistory {
  /** The universe rebuilt at each month start (session index), from the 20 sessions before it. */
  universes: { at: number; date: string; members: UniverseMember[] }[];
  /** Breadth for every session from the first universe on. */
  days: BreadthDay[];
}

/**
 * Rebuilds the universe at every month start that has 20 sessions before it and computes each day's breadth from that
 * month's members. `eligibleAt(i)` returns the common stocks and ETFs that existed at session `i`.
 */
export function breadthHistory(
  dates: readonly string[],
  series: ReadonlyMap<string, TickerSeries>,
  eligibleAt: (i: number) => ReadonlySet<string>,
  size: number = BREADTH_RULES.universeSize,
): BreadthHistory {
  const universes = monthStarts(dates)
    .filter((at) => at >= BREADTH_RULES.rankSessions)
    .map((at) => ({
      at,
      date: dates[at] as string,
      members: rankUniverse(series, eligibleAt(at), at, size),
    }));
  const days: BreadthDay[] = [];
  let u = -1;
  for (let i = 0; i < dates.length; i++) {
    while (u + 1 < universes.length && (universes[u + 1] as { at: number }).at <= i) u += 1;
    if (u < 0) continue;
    const members = (universes[u] as { members: UniverseMember[] }).members.map((m) => m.ticker);
    days.push(breadthOn(dates, series, members, i));
  }
  return { universes, days };
}
