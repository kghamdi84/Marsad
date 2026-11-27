/**
 * Options analytics (formula `options-2`, Phase 6 items 6.3, 6.5 to 6.8), written ahead of options data so the math
 * is tested before any chain arrives: term structure and 25-delta skew, implied against realized earnings moves, the
 * IV-crush guard, unusual-activity filters with their stated limits, and put/call ratios. Pure; nothing here fetches.
 * Volatilities are decimals (0.25 is 25%).
 */
import { liquidityOk } from './options.js';

export const OPTIONS_ANALYTICS_VERSION = 'options-2';

// ---------------------------------------------------------------------------------------------------------------
// 6.3 Term structure and skew

export interface TermPoint {
  /** Calendar days to expiry. */
  dte: number;
  /** At-the-money implied volatility for that expiry. */
  iv: number;
}

export interface TermStructure {
  points: TermPoint[];
  /** 30-day IV interpolated in total variance (iv^2 x t linear in t); null unless 30 days lies between two points. */
  iv30: number | null;
  /** Back-month IV minus front-month IV, in volatility points (0.02 is 2 points); positive is upward sloping. */
  slope: number | null;
  /** True when the front IV is above the back IV (often before an event or in stress). */
  inverted: boolean | null;
}

/** The term structure of ATM implied volatility across expiries. */
export function termStructure(input: readonly TermPoint[]): TermStructure {
  const points = [...input].filter((p) => p.dte > 0 && p.iv > 0).sort((a, b) => a.dte - b.dte);
  const front = points[0];
  const back = points.at(-1);
  let iv30: number | null = null;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as TermPoint;
    const b = points[i] as TermPoint;
    if (a.dte <= 30 && 30 <= b.dte) {
      const wa = a.iv * a.iv * a.dte;
      const wb = b.iv * b.iv * b.dte;
      const w = b.dte === a.dte ? wa : wa + ((wb - wa) * (30 - a.dte)) / (b.dte - a.dte);
      iv30 = Math.sqrt(w / 30);
      break;
    }
  }
  const two = front && back && points.length >= 2;
  return {
    points,
    iv30,
    slope: two ? back.iv - front.iv : null,
    inverted: two ? front.iv > back.iv : null,
  };
}

export interface ChainIv {
  type: 'call' | 'put';
  /** Signed delta: positive for calls, negative for puts. */
  delta: number;
  iv: number;
}

/** IV at |delta| 0.25 for one side, interpolated linearly in delta between the two nearest contracts; null if not bracketed. */
export function ivAtDelta(
  chain: readonly ChainIv[],
  type: 'call' | 'put',
  target = 0.25,
): number | null {
  const side = chain
    .filter((c) => c.type === type && c.iv > 0)
    .map((c) => ({ d: Math.abs(c.delta), iv: c.iv }))
    .sort((a, b) => a.d - b.d);
  for (let i = 1; i < side.length; i++) {
    const a = side[i - 1] as { d: number; iv: number };
    const b = side[i] as { d: number; iv: number };
    if (a.d <= target && target <= b.d)
      return b.d === a.d ? a.iv : a.iv + ((b.iv - a.iv) * (target - a.d)) / (b.d - a.d);
  }
  return null;
}

/**
 * 25-delta skew: put IV minus call IV at 25 delta (positive when downside protection is dearer, the usual equity
 * shape), and the same divided by ATM IV. Null without both wings.
 */
export function skew25(
  chain: readonly ChainIv[],
  atmIv: number,
): { skew: number; normalized: number } | null {
  const put = ivAtDelta(chain, 'put');
  const call = ivAtDelta(chain, 'call');
  if (put === null || call === null || !(atmIv > 0)) return null;
  return { skew: put - call, normalized: (put - call) / atmIv };
}

// ---------------------------------------------------------------------------------------------------------------
// 6.5 Implied against realized earnings moves

export interface ReportMove {
  /** The report date. */
  date: string;
  /** Implied move before the report as a fraction (0.08 is 8%), from the straddle (expectedMove). */
  implied: number;
  /** Close before the report and the first close after it. */
  closeBefore: number;
  closeAfter: number;
}

export interface MoveComparison {
  date: string;
  implied: number;
  /** Absolute move from the close before to the close after. */
  realized: number;
  /** realized / implied. */
  ratio: number;
  exceeded: boolean;
}

/** Moves within this of the implied move count as equal: 105 / 100 - 1 is 0.050000000000000044 in floating point. */
const MOVE_TOLERANCE = 1e-9;

/** The last `count` reports (8 by default): realized against implied, and how many times the stock moved more. */
export function impliedVsRealized(
  moves: readonly ReportMove[],
  count = 8,
): { rows: MoveComparison[]; exceeded: number; n: number; medianRatio: number | null } {
  const rows = [...moves]
    .filter((m) => m.implied > 0 && m.closeBefore > 0 && m.closeAfter > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-count)
    .map((m) => {
      const realized = Math.abs(m.closeAfter / m.closeBefore - 1);
      return {
        date: m.date,
        implied: m.implied,
        realized,
        ratio: realized / m.implied,
        exceeded: realized > m.implied + MOVE_TOLERANCE,
      };
    });
  const ratios = rows.map((r) => r.ratio).sort((a, b) => a - b);
  const mid = ratios.length / 2;
  const medianRatio =
    ratios.length === 0
      ? null
      : ratios.length % 2
        ? (ratios[Math.floor(mid)] as number)
        : ((ratios[mid - 1] as number) + (ratios[mid] as number)) / 2;
  // A count of reports ("3 of 8"), never a percentage: fewer than 30 cases (integrity rule 10).
  return { rows, exceeded: rows.filter((r) => r.exceeded).length, n: rows.length, medianRatio };
}

// ---------------------------------------------------------------------------------------------------------------
// 6.6 IV-crush guard

/**
 * Warns when an idea pays premium (a net debit) and its expiry is on or after an earnings date that is on or after
 * today: implied volatility usually falls after the report, which hurts long premium even when the stock moves.
 */
export function ivCrushWarning(x: {
  netDebit: number;
  expiry: string;
  today: string;
  earningsDate: string | null;
}): string | null {
  if (!(x.netDebit > 0) || x.earningsDate === null) return null;
  if (x.earningsDate < x.today || x.earningsDate > x.expiry) return null;
  return `Long premium across earnings on ${x.earningsDate}: implied volatility usually drops after the report (IV crush), so the position can lose even if the stock moves.`;
}

// ---------------------------------------------------------------------------------------------------------------
// 6.7 Unusual activity

export const UNUSUAL_LIMITS =
  'The feed cannot tell opening from closing trades, hedges, or legs of spreads, so unusual volume is a prompt to look, not a signal of intent.';

export interface ContractActivity {
  contract: string;
  volume: number;
  openInterest: number;
  /** Signed delta. */
  delta: number;
  bid: number;
  ask: number;
  /** Average traded price per share; premium per contract is price x 100. */
  price: number;
}

export interface UnusualRules {
  /** Volume at least this multiple of open interest. */
  minVolumeToOi: number;
  /** Premium traded across the day, in dollars. */
  minPremium: number;
  /** Premium per contract, in dollars: leaves out penny contracts. */
  minPremiumPerContract: number;
  /** |delta| band: leaves out lottery tickets and stock substitutes. */
  deltaBand: [number, number];
}

export const UNUSUAL_DEFAULTS: UnusualRules = {
  minVolumeToOi: 2,
  minPremium: 100_000,
  minPremiumPerContract: 50,
  deltaBand: [0.15, 0.85],
};

/** Contracts that pass every filter, with the numbers that made them pass, largest premium first. */
export function unusualActivity(
  rows: readonly ContractActivity[],
  rules: UnusualRules = UNUSUAL_DEFAULTS,
): { contract: string; volumeToOi: number; premium: number }[] {
  const out: { contract: string; volumeToOi: number; premium: number }[] = [];
  for (const r of rows) {
    if (!(r.openInterest > 0) || !(r.volume > 0)) continue;
    const perContract = r.price * 100;
    const premium = perContract * r.volume;
    const d = Math.abs(r.delta);
    if (r.volume / r.openInterest < rules.minVolumeToOi) continue;
    if (premium < rules.minPremium || perContract < rules.minPremiumPerContract) continue;
    if (d < rules.deltaBand[0] || d > rules.deltaBand[1]) continue;
    if (!liquidityOk(r.bid, r.ask, r.openInterest).ok) continue;
    out.push({ contract: r.contract, volumeToOi: r.volume / r.openInterest, premium });
  }
  return out.sort((a, b) => b.premium - a.premium);
}

// ---------------------------------------------------------------------------------------------------------------
// 6.8 Put/call ratios

export interface PutCallRow {
  /** Equity options or index options (SPX, NDX, RUT and the like), kept apart. */
  kind: 'equity' | 'index';
  type: 'call' | 'put';
  volume: number;
  openInterest: number;
}

export interface PutCallRatios {
  equity: { volume: number | null; openInterest: number | null };
  index: { volume: number | null; openInterest: number | null };
}

/** Put volume over call volume and put open interest over call open interest, equity and index apart; null without calls. */
export function putCallRatios(rows: readonly PutCallRow[]): PutCallRatios {
  const sum = (kind: PutCallRow['kind'], type: PutCallRow['type'], f: 'volume' | 'openInterest') =>
    rows.filter((r) => r.kind === kind && r.type === type).reduce((s, r) => s + r[f], 0);
  const ratio = (kind: PutCallRow['kind'], f: 'volume' | 'openInterest') => {
    const calls = sum(kind, 'call', f);
    return calls > 0 ? sum(kind, 'put', f) / calls : null;
  };
  return {
    equity: { volume: ratio('equity', 'volume'), openInterest: ratio('equity', 'openInterest') },
    index: { volume: ratio('index', 'volume'), openInterest: ratio('index', 'openInterest') },
  };
}
