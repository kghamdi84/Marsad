/**
 * Support and resistance levels (`levels-1`) from stored daily bars. They describe where price turned before; they
 * do not predict where it will turn.
 *
 * - A swing high is a bar whose high is above the highs of the N bars on each side (N = 5); a swing low is a bar
 *   whose low is below the lows of the N bars on each side.
 * - Pivot prices (highs and lows together), sorted, are grouped while each is within 1.5% of the group's mean.
 * - A group with at least 2 pivots is a level at the mean of its prices: support below the last close, resistance
 *   at or above it. At most 4 of each are kept, nearest to the close first.
 * No chart-pattern detection.
 */
import type { DailyBar } from './study.js';

export const LEVELS_VERSION = 'levels-1';
export const LEVEL_RULES = { side: 5, clusterPct: 1.5, minTouches: 2, perSide: 4 } as const;

export interface PriceLevel {
  kind: 'support' | 'resistance';
  price: number;
  touches: number;
  /** Percent from the last close, signed. */
  distancePct: number;
  from: string;
  to: string;
}

export function priceLevels(bars: readonly DailyBar[]): {
  formulaVersion: string;
  asOf: string | null;
  close: number | null;
  levels: PriceLevel[];
} {
  const N = LEVEL_RULES.side;
  const last = bars.at(-1);
  if (!last) return { formulaVersion: LEVELS_VERSION, asOf: null, close: null, levels: [] };
  const pivots: { price: number; date: string }[] = [];
  for (let i = N; i < bars.length - N; i += 1) {
    const b = bars[i] as DailyBar;
    let high = true;
    let low = true;
    for (let j = i - N; j <= i + N; j += 1) {
      if (j === i) continue;
      const o = bars[j] as DailyBar;
      if (o.high >= b.high) high = false;
      if (o.low <= b.low) low = false;
    }
    if (high) pivots.push({ price: b.high, date: b.date });
    if (low) pivots.push({ price: b.low, date: b.date });
  }
  pivots.sort((a, b) => a.price - b.price);
  const groups: { price: number; date: string }[][] = [];
  for (const p of pivots) {
    const g = groups.at(-1);
    const mean = g ? g.reduce((s, x) => s + x.price, 0) / g.length : 0;
    if (g && Math.abs(p.price - mean) / mean <= LEVEL_RULES.clusterPct / 100) g.push(p);
    else groups.push([p]);
  }
  const close = last.close;
  const all: PriceLevel[] = groups
    .filter((g) => g.length >= LEVEL_RULES.minTouches)
    .map((g) => {
      const price = g.reduce((s, x) => s + x.price, 0) / g.length;
      const dates = g.map((x) => x.date).sort();
      return {
        kind: price < close ? 'support' : 'resistance',
        price,
        touches: g.length,
        distancePct: (price / close - 1) * 100,
        from: dates[0] as string,
        to: dates.at(-1) as string,
      };
    });
  const near = (a: PriceLevel, b: PriceLevel) => Math.abs(a.distancePct) - Math.abs(b.distancePct);
  const support = all
    .filter((l) => l.kind === 'support')
    .sort(near)
    .slice(0, LEVEL_RULES.perSide);
  const resistance = all
    .filter((l) => l.kind === 'resistance')
    .sort(near)
    .slice(0, LEVEL_RULES.perSide);
  return {
    formulaVersion: LEVELS_VERSION,
    asOf: last.date,
    close,
    levels: [...resistance, ...support],
  };
}
