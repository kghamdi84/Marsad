/**
 * Watch dashboard numbers (ADR 0014, `watch-1`): a summary of each ticker from its stored daily bars, and the
 * Marsad universe's movers and the sector ETFs from the stored market snapshots. End-of-day data only. Pure.
 */
import type { TickerSeries } from './breadth.js';
import type { DailyBar } from './study.js';

export const WATCH_VERSION = 'watch-1';

/** The Select Sector SPDRs, for the sector heatmap. */
export const SECTOR_ETFS: readonly { ticker: string; sector: string }[] = [
  { ticker: 'XLK', sector: 'Technology' },
  { ticker: 'XLF', sector: 'Financials' },
  { ticker: 'XLE', sector: 'Energy' },
  { ticker: 'XLV', sector: 'Health care' },
  { ticker: 'XLI', sector: 'Industrials' },
  { ticker: 'XLY', sector: 'Consumer discretionary' },
  { ticker: 'XLP', sector: 'Consumer staples' },
  { ticker: 'XLU', sector: 'Utilities' },
  { ticker: 'XLB', sector: 'Materials' },
  { ticker: 'XLRE', sector: 'Real estate' },
  { ticker: 'XLC', sector: 'Communication services' },
];

export interface TickerSummary {
  date: string;
  close: number;
  /** Returns as fractions; null without enough bars. */
  change1d: number | null;
  change5d: number | null;
  change21d: number | null;
  /** Close against the highest close of the last 252 sessions (0 at a new high), null with fewer than 252. */
  fromHigh252: number | null;
  /** The day's volume over the average of the 20 sessions before it. */
  volumeRatio20: number | null;
  /** Open against the previous close (the opening gap). */
  gap: number | null;
}

/** The summary of the newest bar. Bars oldest first, split-adjusted. Null without bars. */
export function tickerSummary(bars: readonly DailyBar[]): TickerSummary | null {
  const n = bars.length;
  const last = bars[n - 1];
  if (!last) return null;
  const back = (k: number) => (n - 1 - k >= 0 ? (bars[n - 1 - k] as DailyBar) : null);
  const ret = (k: number) => {
    const b = back(k);
    return b && b.close > 0 ? last.close / b.close - 1 : null;
  };
  let fromHigh252: number | null = null;
  if (n >= 252) {
    let hi = 0;
    for (let i = n - 252; i < n; i++) hi = Math.max(hi, (bars[i] as DailyBar).close);
    fromHigh252 = last.close / hi - 1;
  }
  let volumeRatio20: number | null = null;
  if (n >= 21) {
    let sum = 0;
    for (let i = n - 21; i < n - 1; i++) sum += (bars[i] as DailyBar).volume;
    volumeRatio20 = sum > 0 ? last.volume / (sum / 20) : null;
  }
  const prev = back(1);
  return {
    date: last.date,
    close: last.close,
    change1d: ret(1),
    change5d: ret(5),
    change21d: ret(21),
    fromHigh252,
    volumeRatio20,
    gap: prev && prev.close > 0 ? last.open / prev.close - 1 : null,
  };
}

export interface Mover {
  ticker: string;
  close: number;
  change: number;
  /** Close times volume on the day. */
  dollarVolume: number;
}

export interface MarketMovers {
  date: string;
  version: string;
  /** Members with a change that day. */
  n: number;
  gainers: Mover[];
  losers: Mover[];
  /** Day change of each sector ETF; null when it did not trade both days. */
  sectors: { ticker: string; sector: string; change: number | null }[];
}

/** A one-day move over 50% after split adjustment is a bad print (ADR 0010) and is left out. */
const SUSPECT = 0.5;

/**
 * The biggest gainers and losers among the universe members on session `i`, from split-adjusted closes, and the
 * sector ETFs' day changes. Ties break by ticker.
 */
export function marketMovers(
  dates: readonly string[],
  series: ReadonlyMap<string, TickerSeries>,
  members: ReadonlySet<string>,
  i: number,
  count = 10,
): MarketMovers {
  const change = (t: string): { close: number; change: number; volume: number } | null => {
    const s = series.get(t);
    const c = s?.close[i];
    const p = s?.close[i - 1];
    const v = s?.volume[i];
    if (c == null || p == null || v == null || p <= 0) return null;
    return { close: c, change: c / p - 1, volume: v };
  };
  const moves: Mover[] = [];
  for (const t of members) {
    const m = change(t);
    if (!m || Math.abs(m.change) > SUSPECT) continue;
    moves.push({ ticker: t, close: m.close, change: m.change, dollarVolume: m.close * m.volume });
  }
  const byUp = [...moves].sort((a, b) => b.change - a.change || a.ticker.localeCompare(b.ticker));
  const byDown = [...moves].sort((a, b) => a.change - b.change || a.ticker.localeCompare(b.ticker));
  return {
    date: dates[i] as string,
    version: WATCH_VERSION,
    n: moves.length,
    gainers: byUp.filter((m) => m.change > 0).slice(0, count),
    losers: byDown.filter((m) => m.change < 0).slice(0, count),
    sectors: SECTOR_ETFS.map((s) => ({ ...s, change: change(s.ticker)?.change ?? null })),
  };
}
