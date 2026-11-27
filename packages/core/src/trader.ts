/**
 * Trader columns (council batch 3, formula `trader-1`): ATR as a share of the price, how stretched the close is from
 * its 20- and 50-day averages in ATRs, relative strength against SPY and the sector fund over 63 sessions, distance
 * from the 52-week closing high, and calendar days to an estimated earnings date. A figure that needs more history
 * than exists is null (data unavailable), never a guess.
 */
import { atr, sma } from './indicators.js';
import { relativeStrength } from './rotation.js';
import type { DailyBar } from './study.js';

export const TRADER_VERSION = 'trader-1';
/** Relative strength window: 63 sessions, about three months. */
export const RS_SESSIONS = 63;

export interface TraderMetrics {
  asOf: string;
  close: number;
  /** Wilder ATR 14 in price units. */
  atr14: number | null;
  /** ATR 14 divided by the close (0.025 is 2.5%). */
  atrPct: number | null;
  /** (close - SMA 20) / ATR 14. */
  stretch20: number | null;
  /** (close - SMA 50) / ATR 14. */
  stretch50: number | null;
  /** 63-session relative strength against SPY: (1 + stock return) / (1 + SPY return) - 1. */
  rsSpy: number | null;
  /** The same against the sector fund, when one is given. */
  rsSector: number | null;
  /** Close against the highest close of the last 252 sessions (0 at a new high); null with fewer than 252. */
  fromHigh: number | null;
  formulaVersion: string;
}

const lastOf = <T>(a: readonly T[]): T | undefined => a[a.length - 1];

/** The trader columns for ascending daily bars; null without any bar. */
export function traderMetrics(
  bars: readonly DailyBar[],
  spy: readonly DailyBar[],
  sector: readonly DailyBar[] | null = null,
): TraderMetrics | null {
  const last = lastOf(bars);
  if (!last) return null;
  const close = bars.map((b) => b.close);
  const a = lastOf(
    atr(
      bars.map((b) => b.high),
      bars.map((b) => b.low),
      close,
      14,
    ),
  );
  const atr14 = a === undefined || a === null ? null : a;
  const s20 = lastOf(sma(close, 20)) ?? null;
  const s50 = lastOf(sma(close, 50)) ?? null;
  const stretch = (avg: number | null) =>
    avg === null || atr14 === null || atr14 === 0 ? null : (last.close - avg) / atr14;
  const window = close.slice(-252);
  return {
    asOf: last.date,
    close: last.close,
    atr14,
    atrPct: atr14 === null || last.close === 0 ? null : atr14 / last.close,
    stretch20: stretch(s20),
    stretch50: stretch(s50),
    rsSpy: relativeStrength(bars, spy, RS_SESSIONS),
    rsSector: sector ? relativeStrength(bars, sector, RS_SESSIONS) : null,
    fromHigh: window.length < 252 ? null : last.close / Math.max(...window) - 1,
    formulaVersion: TRADER_VERSION,
  };
}

/** Calendar days from one ISO date to another (negative when the second is earlier). */
export function daysBetween(fromIso: string, toIso: string): number {
  const d = (s: string) =>
    Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Math.round((d(toIso) - d(fromIso)) / 86_400_000);
}
