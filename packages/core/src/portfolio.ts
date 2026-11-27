/**
 * Portfolio and discipline (ADR 0020, `portfolio-1`): the position sizer, reward-to-risk, the Sahm order ticket text,
 * the Jimmy D pre-trade checklist, a CSV holdings parser and per-holding exit checks. Marsad never places orders:
 * the ticket is plain text Khaled copies into Sahm. Pure.
 */
import { toFixedHalfUp } from './ai/template.js';
import { ema, sma } from './indicators.js';
import type { DailyBar } from './study.js';

export const PORTFOLIO_VERSION = 'portfolio-1';

export interface SizeInput {
  /** Account size in USD. */
  account: number;
  /** Risk per trade as a fraction of the account (0.01 is 1%). */
  riskPct: number;
  entry: number;
  stop: number;
  /** Largest position as a fraction of the account (default 25%). */
  maxPositionPct?: number;
}

export interface SizeResult {
  shares: number;
  /** USD lost if the stop fills exactly. */
  risk: number;
  positionValue: number;
  /** The position's share of the account. */
  pctOfAccount: number;
  /** True when the position cap, not the risk, set the size. */
  capped: boolean;
}

/** Shares for a long trade: the risk budget over the stop distance, rounded down, capped by the position limit. */
export function positionSize(x: SizeInput): SizeResult | { error: string } {
  if (!(x.account > 0)) return { error: 'Account size must be above zero.' };
  if (!(x.riskPct > 0 && x.riskPct <= 0.05))
    return { error: 'Risk per trade must be above 0% and at most 5%.' };
  if (!(x.entry > 0)) return { error: 'Entry must be above zero.' };
  if (!(x.stop > 0 && x.stop < x.entry))
    return { error: 'For a long trade the stop must be below the entry.' };
  const perShare = x.entry - x.stop;
  const byRisk = Math.floor((x.account * x.riskPct) / perShare);
  const cap = Math.floor((x.account * (x.maxPositionPct ?? 0.25)) / x.entry);
  const shares = Math.max(0, Math.min(byRisk, cap));
  if (shares === 0)
    return { error: 'The risk budget buys less than one share at this stop distance.' };
  return {
    shares,
    risk: shares * perShare,
    positionValue: shares * x.entry,
    pctOfAccount: (shares * x.entry) / x.account,
    capped: cap < byRisk,
  };
}

/** Reward-to-risk of each target for a long trade. */
export function rewardRisk(entry: number, stop: number, targets: readonly number[]): number[] {
  const r = entry - stop;
  return targets.map((t) => (r > 0 ? (t - entry) / r : NaN));
}

/**
 * How far a price sits from a stop, as a fraction of the stop: price / stop - 1. Negative means the price is under
 * the stop (a long position's stop has been crossed). Null when either level is not a positive number.
 */
export function gapToStop(price: number, stop: number): number | null {
  if (!(price > 0) || !(stop > 0) || !Number.isFinite(price) || !Number.isFinite(stop)) return null;
  return price / stop - 1;
}

export interface TicketInput {
  side: 'BUY' | 'SELL';
  shares: number;
  ticker: string;
  type: 'LIMIT' | 'MARKET';
  limit?: number;
  stop?: number;
  tif: 'GTC' | 'DAY';
}

/** The order as plain text for Sahm, as the design writes it: "BUY 125 RKLB LIMIT 24.15 STOP 23.70 GTC". */
export function sahmTicket(t: TicketInput): string {
  const price = (v: number) => toFixedHalfUp(v, 2);
  const parts = [
    `${t.side} ${t.shares} ${t.ticker} ${t.type}${t.type === 'LIMIT' && t.limit ? ` ${price(t.limit)}` : ''}`,
  ];
  if (t.stop) parts.push(`STOP ${price(t.stop)}`);
  parts.push(t.tif);
  return parts.join(' ');
}

/**
 * checklist-1, the Jimmy D checklist: patience, process, strict risk, clean setups, take profits, no emotional
 * bias. Trades logged before checklist-2 keep these keys and labels; they are never relabelled.
 */
export const CHECKLIST = [
  { key: 'cleanSetup', label: 'The setup is clean: it matches a written rule, not a feeling.' },
  { key: 'notExtended', label: 'Price is not extended: within the chase limit of the signal.' },
  { key: 'riskDefined', label: 'Risk is defined: the stop is set and the size comes from it.' },
  { key: 'profitPlan', label: 'There is a profit plan: targets and when to take them.' },
  { key: 'bearCaseRead', label: 'I read the bear case and the exit conditions.' },
] as const;

/**
 * checklist-2 (Marsad v2 design, Khaled's choice 2026-11-27): the five checks before an order, used for every new
 * trade and by the Sahm ticket. Different checks from checklist-1, so a trade stores which version it answered.
 */
export const CHECKLIST_V2 = [
  { key: 'regimeFit', label: 'Fits the current regime' },
  { key: 'structuralStop', label: 'Stop set from structure, not hope' },
  { key: 'bearCaseEarnings', label: 'Bear case and earnings date read' },
  { key: 'shariahChecked', label: 'Shariah aid checked' },
  { key: 'manualInSahm', label: 'Order will be entered by hand in Sahm' },
] as const;

export type ChecklistVersion = 'checklist-1' | 'checklist-2';
/** The version new trades and the ticket use. */
export const CURRENT_CHECKLIST: ChecklistVersion = 'checklist-2';

export type ChecklistKey = (typeof CHECKLIST)[number]['key'] | (typeof CHECKLIST_V2)[number]['key'];

/** The items of one checklist version, in order. */
export function checklistItems(
  version: ChecklistVersion,
): readonly { key: ChecklistKey; label: string }[] {
  return version === 'checklist-1' ? CHECKLIST : CHECKLIST_V2;
}

/** Every item of the version must be ticked before the ticket can be copied. */
export function checklistComplete(
  ticked: Partial<Record<ChecklistKey, boolean>>,
  version: ChecklistVersion = CURRENT_CHECKLIST,
): boolean {
  return checklistItems(version).every((c) => ticked[c.key] === true);
}

export interface Holding {
  ticker: string;
  shares: number;
  /** Cost per share in USD. */
  costBasis: number;
  openedOn: string;
  stop: number | null;
  targets: number[];
  /** Trend-break rule: close below this moving average. */
  trendBreak: { ind: 'sma' | 'ema'; period: number } | null;
  /** Sell after this many sessions without reaching a target. */
  timeStopSessions: number | null;
}

/** Sessions traded since the position was opened (bars after the opening date), as the time stop counts them. */
export function sessionsHeld(bars: readonly { date: string }[], openedOn: string): number {
  return bars.filter((b) => b.date > openedOn).length;
}

/**
 * Which incoming CSV rows repeat a holding already stored, or an earlier row of the same file: same ticker, opening
 * date, shares and cost. True marks a duplicate to skip.
 */
export function markDuplicateHoldings(
  existing: readonly Pick<Holding, 'ticker' | 'openedOn' | 'shares' | 'costBasis'>[],
  incoming: readonly Pick<Holding, 'ticker' | 'openedOn' | 'shares' | 'costBasis'>[],
): boolean[] {
  const key = (h: Pick<Holding, 'ticker' | 'openedOn' | 'shares' | 'costBasis'>) =>
    `${h.ticker}|${h.openedOn}|${h.shares}|${h.costBasis}`;
  const seen = new Set(existing.map(key));
  return incoming.map((h) => {
    const k = key(h);
    if (seen.has(k)) return true;
    seen.add(k);
    return false;
  });
}

/** Parses holdings CSV with the header ticker,shares,cost_basis,opened_on[,stop,targets,trend_break,time_stop_sessions]. */
export function parseHoldingsCsv(text: string): { holdings: Holding[]; errors: string[] } {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .filter((l) => l.trim() !== '');
  const errors: string[] = [];
  const holdings: Holding[] = [];
  const header = (lines[0] ?? '').split(',').map((h) => h.trim().toLowerCase());
  const need = ['ticker', 'shares', 'cost_basis', 'opened_on'];
  const missing = need.filter((h) => !header.includes(h));
  if (missing.length > 0) return { holdings, errors: [`Missing columns: ${missing.join(', ')}.`] };
  const col = (row: string[], name: string) => {
    const i = header.indexOf(name);
    return i < 0 ? '' : (row[i] ?? '').trim();
  };
  lines.slice(1).forEach((line, k) => {
    const n = k + 2;
    const row = line.split(',');
    const ticker = col(row, 'ticker').toUpperCase();
    const shares = Number(col(row, 'shares'));
    const cost = Number(col(row, 'cost_basis'));
    const opened = col(row, 'opened_on');
    const stopRaw = col(row, 'stop');
    const targetsRaw = col(row, 'targets');
    const trendRaw = col(row, 'trend_break').toLowerCase();
    const timeRaw = col(row, 'time_stop_sessions');
    const problems: string[] = [];
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker)) problems.push('ticker');
    if (!(shares > 0)) problems.push('shares');
    if (!(cost > 0)) problems.push('cost_basis');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(opened)) problems.push('opened_on (YYYY-MM-DD)');
    const stop = stopRaw === '' ? null : Number(stopRaw);
    if (stop !== null && !(stop > 0)) problems.push('stop');
    const targets = targetsRaw === '' ? [] : targetsRaw.split(/[;| ]+/).map(Number);
    if (targets.some((t) => !(t > 0))) problems.push('targets (separate with ;)');
    const tm = /^(sma|ema)(\d{1,3})$/.exec(trendRaw);
    if (trendRaw !== '' && !tm) problems.push('trend_break (like sma50 or ema20)');
    const time = timeRaw === '' ? null : Number(timeRaw);
    if (time !== null && !(Number.isInteger(time) && time > 0)) problems.push('time_stop_sessions');
    if (problems.length > 0) {
      errors.push(`Line ${n}: check ${problems.join(', ')}.`);
      return;
    }
    holdings.push({
      ticker,
      shares,
      costBasis: cost,
      openedOn: opened,
      stop,
      targets,
      trendBreak: tm ? { ind: tm[1] as 'sma' | 'ema', period: Number(tm[2]) } : null,
      timeStopSessions: time,
    });
  });
  return { holdings, errors };
}

export interface ExitSignal {
  kind: 'stop' | 'target' | 'trend-break' | 'time-stop';
  date: string;
  detail: string;
}

/**
 * The exit rules that hold at the newest close (completed bars only): a close at or below the stop, at or above a
 * target, below the trend-break average, or the time stop reached. Every holding has explicit exit conditions;
 * holding is never the default.
 */
export function exitSignals(h: Holding, bars: readonly DailyBar[]): ExitSignal[] {
  const last = bars.at(-1);
  if (!last) return [];
  const p = (v: number) => toFixedHalfUp(v, 2);
  const out: ExitSignal[] = [];
  if (h.stop !== null && last.close <= h.stop)
    out.push({
      kind: 'stop',
      date: last.date,
      detail: `Closed at ${p(last.close)}, at or below the stop ${p(h.stop)}.`,
    });
  const hit = h.targets.filter((t) => last.close >= t);
  if (hit.length > 0)
    out.push({
      kind: 'target',
      date: last.date,
      detail: `Closed at ${p(last.close)}, at or above target ${p(Math.max(...hit))}: take profits as planned.`,
    });
  if (h.trendBreak) {
    const closes = bars.map((b) => b.close);
    const avg =
      (h.trendBreak.ind === 'sma' ? sma : ema)(closes, h.trendBreak.period).at(-1) ?? null;
    if (avg !== null && last.close < avg)
      out.push({
        kind: 'trend-break',
        date: last.date,
        detail: `Closed at ${p(last.close)}, below the ${h.trendBreak.period}-day ${h.trendBreak.ind.toUpperCase()} ${p(avg)}.`,
      });
  }
  if (h.timeStopSessions !== null) {
    const held = sessionsHeld(bars, h.openedOn);
    if (held >= h.timeStopSessions && hit.length === 0)
      out.push({
        kind: 'time-stop',
        date: last.date,
        detail: `${held} sessions since ${h.openedOn} without reaching a target (time stop ${h.timeStopSessions}).`,
      });
  }
  return out;
}

/** Unrealized result of a holding at a price: USD and fraction. */
export interface PortfolioTotals {
  /** Market value of the holdings that have a price. */
  value: number;
  /** What those holdings cost. */
  cost: number;
  gainUsd: number;
  /** Gain on cost; null when nothing is priced. */
  gainPct: number | null;
  /** Holdings left out because no price is stored. */
  unpriced: string[];
}

/** Value, cost and open gain of the holdings, from each ticker's last close. Unpriced holdings are listed, not guessed. */
export function portfolioTotals(
  holdings: readonly Pick<Holding, 'ticker' | 'shares' | 'costBasis'>[],
  lastClose: (ticker: string) => number | null,
): PortfolioTotals {
  let value = 0;
  let cost = 0;
  const unpriced: string[] = [];
  for (const h of holdings) {
    const p = lastClose(h.ticker);
    if (p === null) {
      unpriced.push(h.ticker);
      continue;
    }
    value += p * h.shares;
    cost += h.costBasis * h.shares;
  }
  return {
    value,
    cost,
    gainUsd: value - cost,
    gainPct: cost > 0 ? value / cost - 1 : null,
    unpriced,
  };
}

export function unrealized(
  h: Pick<Holding, 'shares' | 'costBasis'>,
  price: number,
): { usd: number; pct: number } {
  return { usd: (price - h.costBasis) * h.shares, pct: price / h.costBasis - 1 };
}
