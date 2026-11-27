/**
 * Stock-to-ETF rotation signal (ADR 0022, `rotation-1`): a holding's 3-, 6- and 12-month relative strength
 * against its sector ETF and SPY, its trend, and the thesis status Khaled sets. When the stock lags and its thesis
 * is weakening or broken, the signal suggests the sector ETF (or SPY) instead. Code decides; holding is never the
 * default answer. Pure.
 */
import { sma } from './indicators.js';
import type { DailyBar } from './study.js';
import { toFixedHalfUp } from './ai/template.js';

export const ROTATION_VERSION = 'rotation-1';

/** Sessions in 3, 6 and 12 months. */
export const RS_PERIODS = { m3: 63, m6: 126, m12: 252 } as const;

/** Only the date and close of a daily bar (what a relative return needs). */
export type CloseBar = Pick<DailyBar, 'date' | 'close'>;

export type ThesisStatus = 'intact' | 'weakening' | 'broken';

export interface RsSet {
  m3: number | null;
  m6: number | null;
  m12: number | null;
}

/**
 * Relative strength over `period` common sessions: (1 + stock return) / (1 + benchmark return) - 1.
 * Positive means the stock beat the benchmark. Null with too little common history.
 */
export function relativeStrength(
  stock: readonly CloseBar[],
  bench: readonly CloseBar[],
  period: number,
): number | null {
  const b = new Map(bench.map((x) => [x.date, x.close]));
  const common = stock.filter((x) => b.has(x.date));
  if (common.length <= period) return null;
  const end = common[common.length - 1] as CloseBar;
  const start = common[common.length - 1 - period] as CloseBar;
  const rs = end.close / start.close;
  const rb = (b.get(end.date) as number) / (b.get(start.date) as number);
  return rs / rb - 1;
}

const rsSet = (s: readonly DailyBar[], b: readonly DailyBar[]): RsSet => ({
  m3: relativeStrength(s, b, RS_PERIODS.m3),
  m6: relativeStrength(s, b, RS_PERIODS.m6),
  m12: relativeStrength(s, b, RS_PERIODS.m12),
});

export type TrendState = 'up' | 'down' | 'mixed';

/** Up: close above the 200-day average and the 50-day above the 200-day; down: both below; otherwise mixed. */
export function trendOf(bars: readonly DailyBar[]): TrendState | null {
  const closes = bars.map((b) => b.close);
  const s50 = sma(closes, 50).at(-1);
  const s200 = sma(closes, 200).at(-1);
  const c = closes.at(-1);
  if (s50 == null || s200 == null || c === undefined) return null;
  if (c > s200 && s50 > s200) return 'up';
  if (c < s200 && s50 < s200) return 'down';
  return 'mixed';
}

export interface RotationResult {
  version: string;
  ticker: string;
  vsSector: RsSet | null;
  vsSpy: RsSet;
  trend: TrendState | null;
  thesis: ThesisStatus;
  lagging: boolean;
  suggestion: 'rotate' | 'review' | 'none' | 'insufficient';
  text: string;
}

const pct = (v: number) => `${v >= 0 ? '+' : ''}${toFixedHalfUp(v * 100, 1)}%`;

export function rotationSignal(x: {
  ticker: string;
  bars: readonly DailyBar[];
  spy: readonly DailyBar[];
  sectorEtf: string | null;
  sectorBars: readonly DailyBar[] | null;
  thesis: ThesisStatus;
}): RotationResult {
  const vsSpy = rsSet(x.bars, x.spy);
  const vsSector = x.sectorEtf && x.sectorBars ? rsSet(x.bars, x.sectorBars) : null;
  const trend = trendOf(x.bars);
  const base = {
    version: ROTATION_VERSION,
    ticker: x.ticker,
    vsSector,
    vsSpy,
    trend,
    thesis: x.thesis,
  };
  const bench = vsSector ?? vsSpy;
  const benchName = vsSector ? (x.sectorEtf as string) : 'SPY';
  if (bench.m3 === null || bench.m6 === null || vsSpy.m6 === null)
    return {
      ...base,
      lagging: false,
      suggestion: 'insufficient',
      text: 'Less than six months of common history: no rotation signal.',
    };
  const lagging = bench.m3 < 0 && bench.m6 < 0 && vsSpy.m6 < 0;
  const lagText = `${pct(bench.m3)} over 3 months and ${pct(bench.m6)} over 6 months against ${benchName}, ${pct(vsSpy.m6)} over 6 months against SPY`;
  if (lagging && x.thesis !== 'intact')
    return {
      ...base,
      lagging,
      suggestion: 'rotate',
      text: `Lags: ${lagText}, and the thesis is ${x.thesis}. Consider ${benchName === 'SPY' ? 'SPY' : `${benchName} or SPY`} instead.`,
    };
  if (lagging && trend === 'down')
    return {
      ...base,
      lagging,
      suggestion: 'review',
      text: `Lags (${lagText}) in a downtrend while the thesis is marked intact: review the thesis.`,
    };
  return {
    ...base,
    lagging,
    suggestion: 'none',
    text: lagging
      ? `Lags (${lagText}); trend ${trend ?? 'unknown'}, thesis intact. The exit rules still apply.`
      : `Not lagging ${benchName} on both 3 and 6 months. The exit rules still apply.`,
  };
}
