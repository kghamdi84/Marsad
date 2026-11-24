/**
 * Instrument identity and split handling.
 *
 * Identity: companies are linked by CIK (SEC) and FIGI (OpenFIGI), never by ticker, so a ticker
 * change does not break history. The ticker is only a display symbol.
 *
 * Splits: indicators use adjusted bars, and P&L uses actual prices. A move above 25% must be
 * checked against splits before it is called a market move.
 */
import { etDate } from './calendar.js';

export interface InstrumentRef {
  /** SEC Central Index Key, zero-padded to 10 digits. Null if the issuer has none (many ETFs). */
  cik: string | null;
  /** Composite FIGI, 12 characters. */
  figi: string | null;
  ticker: string;
}

/** Normalises a CIK to 10 digits, or throws. */
export function normalizeCik(cik: string | number): string {
  const s = String(cik).trim();
  if (!/^\d{1,10}$/.test(s)) throw new RangeError(`Bad CIK: ${s}`);
  return s.padStart(10, '0');
}

/** A FIGI is 12 alphanumeric characters starting with "BBG" for composite FIGIs. */
export function isFigi(value: string): boolean {
  return /^BBG[A-Z0-9]{9}$/.test(value);
}

/** The stable key of an instrument: FIGI if known, else CIK plus ticker, else the ticker alone. */
export function instrumentKey(ref: InstrumentRef): string {
  if (ref.figi) return `figi:${ref.figi}`;
  if (ref.cik) return `cik:${ref.cik}:${ref.ticker}`;
  return `ticker:${ref.ticker}`;
}

export interface Split {
  ticker: string;
  executionDate: string; // YYYY-MM-DD, the first day the split-adjusted price trades
  splitFrom: number;
  splitTo: number;
  adjustmentType: 'forward_split' | 'reverse_split' | 'stock_dividend' | string;
  /** The vendor's identifier and cumulative factor, kept when the split came from the vendor feed. */
  vendorId?: string;
  historicalAdjustmentFactor?: number;
}

/** The factor that converts a price before this split to a price after it: from / to. */
export function splitFactor(s: Split): number {
  if (!(s.splitFrom > 0) || !(s.splitTo > 0)) throw new RangeError('split ratio must be positive');
  return s.splitFrom / s.splitTo;
}

/**
 * Cumulative adjustment factor for a price observed on `date`: the product of the factors of every
 * split executing after that date. This matches the vendor's `historical_adjustment_factor`.
 */
export function cumulativeFactor(date: string, splits: readonly Split[]): number {
  let f = 1;
  for (const s of splits) if (s.executionDate > date) f *= splitFactor(s);
  return f;
}

export interface Bar {
  t: number; // epoch ms
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  /** The vendor's volume-weighted average price for the bar, when it supplies one. */
  vw?: number;
}

/** Split-adjusts bars: prices are scaled by the factor, volume by its inverse. */
export function adjustBars(bars: readonly Bar[], splits: readonly Split[]): Bar[] {
  return bars.map((b) => {
    const f = cumulativeFactor(etDate(new Date(b.t)), splits);
    return f === 1 ? b : { t: b.t, o: b.o * f, h: b.h * f, l: b.l * f, c: b.c * f, v: b.v / f };
  });
}

/** The fractional move from `previous` to `current`, for example 0.27 for +27%. */
export function fractionalMove(previous: number, current: number): number {
  if (!(previous > 0)) throw new RangeError('previous price must be positive');
  return current / previous - 1;
}

export const BIG_MOVE_THRESHOLD = 0.25;

export interface MoveCheck {
  big: boolean;
  /** A split executing on `moveDate` (or the next trading day) whose ratio accounts for the move. */
  explainedBy: Split | null;
}

/**
 * Before alerting on a move above 25%, check whether a split explains it. A split explains a move
 * when it executes on the move's date and the unadjusted price ratio is close to the split ratio
 * (within `tolerance`, default 15% of the ratio).
 */
export function checkBigMove(
  previousClose: number,
  price: number,
  moveDate: string,
  splits: readonly Split[],
  tolerance = 0.15,
): MoveCheck {
  const move = fractionalMove(previousClose, price);
  const big = Math.abs(move) > BIG_MOVE_THRESHOLD;
  if (!big) return { big, explainedBy: null };
  const ratio = price / previousClose;
  for (const s of splits) {
    if (s.executionDate !== moveDate) continue;
    // The price after a split trades at (from / to) of the price before it.
    const target = splitFactor(s);
    if (Math.abs(ratio - target) / target <= tolerance) return { big, explainedBy: s };
  }
  return { big, explainedBy: null };
}
