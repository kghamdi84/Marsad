/**
 * Technical summary (`technical-1`): seven stated rules on the stored daily bars, each true, false or not
 * available, and a count of how many are positive. It describes the chart; it never says buy or sell.
 *
 * 1. above-sma20: the last close is above its 20-session simple average.
 * 2. above-sma50: the last close is above its 50-session simple average.
 * 3. above-sma200: the last close is above its 200-session simple average.
 * 4. sma50-above-sma200: the 50-session average is above the 200-session average.
 * 5. rsi-50: RSI 14 (Wilder) is at or above 50. Its zone (under 30, 30 to 50, 50 to 70, 70 and over) is reported
 *    beside it.
 * 6. macd-above-signal: the MACD line (12, 26) is above its 9-session signal line.
 * 7. upper-half-52w: the last close sits in the upper half of the 52-week (252-session) high to low range.
 *
 * A rule that needs more history than is stored is null. The count is over the rules that could be computed.
 */
import { FORMULA_VERSIONS, macd, rsi, sma } from './indicators.js';
import type { DailyBar } from './study.js';

export const TECHNICAL_VERSION = 'technical-1';

export type TechnicalSignalId =
  | 'above-sma20'
  | 'above-sma50'
  | 'above-sma200'
  | 'sma50-above-sma200'
  | 'rsi-50'
  | 'macd-above-signal'
  | 'upper-half-52w';

export type RsiZone = 'under-30' | '30-50' | '50-70' | '70-plus';

export interface TechnicalSignal {
  id: TechnicalSignalId;
  positive: boolean | null;
  /** The reading: the close, an average, RSI, the MACD line or the range position in percent. */
  value: number | null;
  /** What it is compared with: the average, 200-day average, 50, the signal line or 50%. */
  reference: number | null;
  /** Sessions the rule needs. */
  needs: number;
}

export interface TechnicalSummary {
  formulaVersion: string;
  indicatorVersions: string;
  asOf: string | null;
  close: number | null;
  signals: TechnicalSignal[];
  positive: number;
  available: number;
  rsiZone: RsiZone | null;
  /** The 52-week range used for rule 7, or null with fewer than 252 sessions. */
  range52w: { low: number; high: number; positionPct: number } | null;
}

const lastOf = (s: readonly (number | null)[]): number | null => s.at(-1) ?? null;

export function rsiZone(v: number): RsiZone {
  return v < 30 ? 'under-30' : v < 50 ? '30-50' : v < 70 ? '50-70' : '70-plus';
}

export function technicalSummary(bars: readonly DailyBar[]): TechnicalSummary {
  for (let i = 1; i < bars.length; i += 1)
    if ((bars[i] as DailyBar).date <= (bars[i - 1] as DailyBar).date)
      throw new RangeError(`Bars are not in ascending date order at ${(bars[i] as DailyBar).date}`);
  const closes = bars.map((b) => b.close);
  const close = closes.at(-1) ?? null;
  const s20 = lastOf(sma(closes, 20));
  const s50 = lastOf(sma(closes, 50));
  const s200 = lastOf(sma(closes, 200));
  const r = lastOf(rsi(closes, 14));
  const m = macd(closes);
  const line = lastOf(m.line);
  const signal = lastOf(m.signal);

  let range52w: TechnicalSummary['range52w'] = null;
  if (bars.length >= 252 && close !== null) {
    const w = bars.slice(-252);
    const low = Math.min(...w.map((b) => b.low));
    const high = Math.max(...w.map((b) => b.high));
    if (high > low) range52w = { low, high, positionPct: ((close - low) / (high - low)) * 100 };
  }

  const cmp = (
    id: TechnicalSignalId,
    value: number | null,
    reference: number | null,
    needs: number,
    test: (v: number, ref: number) => boolean,
  ): TechnicalSignal => ({
    id,
    value,
    reference,
    needs,
    positive: value === null || reference === null ? null : test(value, reference),
  });
  const gt = (v: number, ref: number) => v > ref;

  const signals: TechnicalSignal[] = [
    cmp('above-sma20', s20 === null ? null : close, s20, 20, gt),
    cmp('above-sma50', s50 === null ? null : close, s50, 50, gt),
    cmp('above-sma200', s200 === null ? null : close, s200, 200, gt),
    cmp('sma50-above-sma200', s200 === null ? null : s50, s200, 200, gt),
    cmp('rsi-50', r, r === null ? null : 50, 15, (v, ref) => v >= ref),
    cmp('macd-above-signal', signal === null ? null : line, signal, 34, gt),
    cmp(
      'upper-half-52w',
      range52w ? range52w.positionPct : null,
      range52w ? 50 : null,
      252,
      (v, ref) => v >= ref,
    ),
  ];
  return {
    formulaVersion: TECHNICAL_VERSION,
    indicatorVersions: [
      FORMULA_VERSIONS.sma,
      FORMULA_VERSIONS.rsi,
      FORMULA_VERSIONS.macd,
      FORMULA_VERSIONS.ema,
    ].join(', '),
    asOf: bars.at(-1)?.date ?? null,
    close,
    signals,
    positive: signals.filter((s) => s.positive === true).length,
    available: signals.filter((s) => s.positive !== null).length,
    rsiZone: r === null ? null : rsiZone(r),
    range52w,
  };
}
