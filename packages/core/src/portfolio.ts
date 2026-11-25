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

export interface TicketInput {
  side: 'BUY' | 'SELL';
  shares: number;
  ticker: string;
  type: 'LIMIT' | 'MARKET';
  limit?: number;
  stop?: number;
  tif: 'GTC' | 'DAY';
}

/** The order as plain text for Sahm, for example "BUY 125 RKLB LIMIT 24.15, STOP 23.70, GTC". */
export function sahmTicket(t: TicketInput): string {
  const price = (v: number) => toFixedHalfUp(v, 2);
  const parts = [
    `${t.side} ${t.shares} ${t.ticker} ${t.type}${t.type === 'LIMIT' && t.limit ? ` ${price(t.limit)}` : ''}`,
  ];
  if (t.stop) parts.push(`STOP ${price(t.stop)}`);
  parts.push(t.tif);
  return parts.join(', ');
}

/** The Jimmy D checklist: patience, process, strict risk, clean setups, take profits, no emotional bias. */
export const CHECKLIST = [
  { key: 'cleanSetup', label: 'The setup is clean: it matches a written rule, not a feeling.' },
  { key: 'notExtended', label: 'Price is not extended: within the chase limit of the signal.' },
  { key: 'riskDefined', label: 'Risk is defined: the stop is set and the size comes from it.' },
  { key: 'profitPlan', label: 'There is a profit plan: targets and when to take them.' },
  { key: 'bearCaseRead', label: 'I read the bear case and the exit conditions.' },
] as const;

export type ChecklistKey = (typeof CHECKLIST)[number]['key'];

/** Every item must be ticked before the ticket can be copied. */
export function checklistComplete(ticked: Partial<Record<ChecklistKey, boolean>>): boolean {
  return CHECKLIST.every((c) => ticked[c.key] === true);
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
    const held = bars.filter((b) => b.date > h.openedOn).length;
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
export function unrealized(
  h: Pick<Holding, 'shares' | 'costBasis'>,
  price: number,
): { usd: number; pct: number } {
  return { usd: (price - h.costBasis) * h.shares, pct: price / h.costBasis - 1 };
}
