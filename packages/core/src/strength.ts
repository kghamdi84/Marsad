/**
 * Strength rank within the Marsad universe (council leftover, formula `strength-1`): each member's 63-session price
 * return from the stored grouped-daily closes (split-adjusted by the breadth job), ranked best first. The percentile
 * says how many members it beat: 100 is the strongest, 0 the weakest. Members without a close at both ends are left
 * out, never filled in. A universe measure from end-of-day data, not an index or vendor ranking.
 */
import type { TickerSeries } from './breadth.js';

export const STRENGTH_VERSION = 'strength-1';
export const STRENGTH_SESSIONS = 63;

export interface StrengthRank {
  ticker: string;
  /** Price return over the window (0.12 is +12%). */
  return63: number;
  /** 1 is the strongest; equal returns share a rank. */
  rank: number;
  /** Members with a return on this date. */
  members: number;
  /** 100 x (members - rank) / (members - 1); 100 when there is one member. */
  percentile: number;
}

/** Ranks the universe members at session `at` by their return over the last `period` sessions. */
export function strengthRanks(
  series: ReadonlyMap<string, TickerSeries>,
  members: readonly string[],
  at: number,
  period = STRENGTH_SESSIONS,
): StrengthRank[] {
  if (at - period < 0) return [];
  const returns: { ticker: string; r: number }[] = [];
  for (const ticker of new Set(members)) {
    const s = series.get(ticker);
    const end = s?.close[at];
    const start = s?.close[at - period];
    if (end == null || start == null || !(start > 0) || !(end > 0)) continue;
    returns.push({ ticker, r: end / start - 1 });
  }
  returns.sort((a, b) => b.r - a.r || a.ticker.localeCompare(b.ticker));
  const n = returns.length;
  const out: StrengthRank[] = [];
  returns.forEach((x, i) => {
    const prev = out[i - 1];
    const rank = prev && returns[i - 1]?.r === x.r ? prev.rank : i + 1;
    out.push({
      ticker: x.ticker,
      return63: x.r,
      rank,
      members: n,
      percentile: n === 1 ? 100 : (100 * (n - rank)) / (n - 1),
    });
  });
  return out;
}
