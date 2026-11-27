/**
 * Sector rotation against SPY (`sector-rotation-1`, Marsad v2 Regime page): each Select Sector SPDR's relative
 * return against SPY over 1 week, 1 month and 3 months (5, 21 and 63 sessions), from stored end-of-day closes.
 * Relative return is (1 + fund return) / (1 + SPY return) - 1 over the same common sessions, the same measure as
 * `relativeStrength` in the rotation signal. Pure.
 */
import { relativeStrength, type CloseBar } from './rotation.js';

export const SECTOR_ROTATION_VERSION = 'sector-rotation-1';

/** Sessions in 1 week, 1 month and 3 months. */
export const SECTOR_ROTATION_WINDOWS = { w1: 5, m1: 21, m3: 63 } as const;

export type SectorRotationState = 'ok' | 'stale' | 'no-data';

export interface SectorRotationRow {
  ticker: string;
  /** The fund's newest stored bar, or null without bars. */
  asOf: string | null;
  /**
   * ok: the fund's newest bar is SPY's newest bar. stale: it is older, so every value is null rather than a return
   * over a different window. no-data: no bars for the fund or for SPY.
   */
  state: SectorRotationState;
  /** Relative return as a fraction (0.024 is 2.4 percentage points ahead of SPY); null with too little history. */
  w1: number | null;
  m1: number | null;
  m3: number | null;
}

export interface SectorRotation {
  version: string;
  /** SPY's newest stored bar: the date every ok row is measured to. Null without SPY bars. */
  asOf: string | null;
  rows: SectorRotationRow[];
}

/** One row per fund, in the order given. Bars oldest first; dates are ET trading days. */
export function sectorRotation(
  funds: readonly { ticker: string; bars: readonly CloseBar[] }[],
  spy: readonly CloseBar[],
): SectorRotation {
  const asOf = spy.at(-1)?.date ?? null;
  const W = SECTOR_ROTATION_WINDOWS;
  const rows = funds.map(({ ticker, bars }): SectorRotationRow => {
    const last = bars.at(-1)?.date ?? null;
    const empty = { ticker, asOf: last, w1: null, m1: null, m3: null };
    if (asOf === null || last === null) return { ...empty, state: 'no-data' };
    if (last !== asOf) return { ...empty, state: 'stale' };
    return {
      ticker,
      asOf: last,
      state: 'ok',
      w1: relativeStrength(bars, spy, W.w1),
      m1: relativeStrength(bars, spy, W.m1),
      m3: relativeStrength(bars, spy, W.m3),
    };
  });
  return { version: SECTOR_ROTATION_VERSION, asOf, rows };
}
