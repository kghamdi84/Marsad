/**
 * Portfolio check (`portfolio-check-1`): Marsad's code-built replacement for a portfolio "health score". Every part
 * is computed from stored data and compared with Khaled's limits (`PORTFOLIO_LIMITS`) or a stated check rule (`CHECK_RULES`); nothing is blended into one
 * opaque number, and nothing here says what to do. Also the holdings-table formulas (period returns, trailing
 * dividends, price against its averages), the "current holdings at today's weights" series against SPY, the
 * distribution buckets, the portfolio P/E, the closed-trade summary, the activity list, weekly moves and the dated
 * list of coming events. Pure. Known answers are hand-checked in `portfolio-check.test.ts`.
 */
import { toFixedHalfUp } from './ai/template.js';
import { periodReturn, type PeriodReturn } from './company-brief.js';
import { exposureReport } from './exposure.js';
import { atr, rsi, sma } from './indicators.js';
import { adherenceVsResult, pnl, rMultiple, statsBySetup, type JournalTrade } from './journal.js';
import {
  exitSignals,
  gapToStop,
  positionSize,
  sessionsHeld,
  type ExitSignal,
  type Holding,
} from './portfolio.js';
import { maxDrawdown, MIN_CASES, stdev } from './stats.js';
import type { DailyBar } from './study.js';
import { daysBetween } from './trader.js';

export const PORTFOLIO_CHECK_VERSION = 'portfolio-check-1';

/**
 * Khaled's portfolio limits, set by the council at his request on 28 Nov 2026 (ADR 0048, round 2) and his to change
 * at any time. They are his, never a Marsad default for anyone else: a member starts with no limit set (see
 * `resolveLimits`). Fractions of equity (0.2 is 20%), except beta. A breach is a fact shown with its figures.
 */
export const PORTFOLIO_LIMITS = Object.freeze({
  /** Largest single position, share of equity. */
  largestPosition: 0.2,
  /** The five largest positions together. */
  top5: 0.6,
  /** Minimum cash, share of equity. */
  minCash: 0.1,
  /** Maximum value-weighted beta to SPY. */
  portfolioBeta: 1.5,
  /** Maximum total open risk: the sum of (close minus stop) times shares, share of equity. */
  openRisk: 0.06,
});

/** The date the council set the limits, for the label "Set by the council at your request on ...". */
export const LIMITS_SET_ON = '2026-11-28';

export type LimitKey = keyof typeof PORTFOLIO_LIMITS;
export type PortfolioLimits = Record<LimitKey, number | null>;

/**
 * The limits that apply to the signed-in person: their stored limits when given (a later batch stores and edits
 * them), else for the owner the council's values, else none ("No limit set"). A stored null clears one limit.
 */
export function resolveLimits(x: {
  role: 'owner' | 'member';
  user?: Partial<PortfolioLimits> | null;
}): { limits: PortfolioLimits; source: 'user' | 'council' | 'none' } {
  const none: PortfolioLimits = {
    largestPosition: null,
    top5: null,
    minCash: null,
    portfolioBeta: null,
    openRisk: null,
  };
  const base: PortfolioLimits = x.role === 'owner' ? { ...PORTFOLIO_LIMITS } : none;
  if (x.user) return { limits: { ...base, ...x.user }, source: 'user' };
  return { limits: base, source: x.role === 'owner' ? 'council' : 'none' };
}

/**
 * Marsad's check rules: the thresholds the other check rows, the "Needs attention" cards and the review compare
 * against, stated on screen beside each number. Fractions unless the name says otherwise. A value past one is a
 * fact to read, not an instruction.
 */
export const CHECK_RULES = Object.freeze({
  /** The largest sector. */
  sector: 0.4,
  /** Annualized volatility of the current mix over up to a year of stored bars. */
  volatility: 0.35,
  /** Largest peak-to-trough fall of the current mix over the same span (compared as a positive fraction). */
  drawdown: 0.25,
  /** Share of positions priced below their cost. */
  belowCostShare: 0.5,
  /** Card: a position down this much or more from cost. */
  downFromCost: 0.4,
  /** Card: one position holding more than this share of the book's total unrealized loss. */
  lossShare: 0.25,
  /** Card: a position beta above this. */
  highBeta: 2,
  /** Card: the whole book's unrealized result below minus this share of cost. */
  bookLoss: 0.25,
  /** Weekly moves: a holding that moved more than this over the last five sessions. */
  weeklyMove: 0.05,
  /** Coming up: calendar days ahead. */
  comingUpDays: 56,
  /** Review: the sizer's own defaults, risk per trade (the Sizer form's 1%) and the position cap (25%). */
  sizerRisk: 0.01,
  sizerCap: 0.25,
});

/**
 * Dividend withholding used for net income: 30%, the US rate for a non-treaty resident (IRS Publication 515).
 * Khaled to confirm his broker's W-8BEN treatment (ADR 0048, open question 2).
 */
export const DIVIDEND_WITHHOLDING = 0.3;

/**
 * Bucket edges for the holdings distribution. A value goes in the first bucket whose `below` it is under (lower
 * edge inclusive). Market cap in USD. A P/E at or below zero, or missing, is "not meaningful"; a missing market
 * cap or beta is "unavailable".
 */
export const DISTRIBUTION_BUCKETS = Object.freeze({
  marketCap: [
    { key: 'micro', below: 300e6 },
    { key: 'small', below: 2e9 },
    { key: 'mid', below: 10e9 },
    { key: 'large', below: 200e9 },
    { key: 'mega', below: Infinity },
  ],
  beta: [
    { key: 'low', below: 0.8 },
    { key: 'market', below: 1.2 },
    { key: 'high', below: 2 },
    { key: 'very-high', below: Infinity },
  ],
  pe: [
    { key: 'under-15', below: 15 },
    { key: '15-25', below: 25 },
    { key: '25-40', below: 40 },
    { key: 'over-40', below: Infinity },
  ],
} as const);

/** Sessions for the holdings-table periods; YTD is counted from the last close of the previous year. */
export const PERIOD_SESSIONS = Object.freeze({ w1: 5, m1: 21, m3: 63, m6: 126, y1: 252 });

const TRADING_DAYS = 252;

// ---------------------------------------------------------------------------------------------------------------
// Positions

/** One holding lot as the check takes it. `sector` is the label already resolved by the caller (or null). */
export interface BookLot {
  ticker: string;
  shares: number;
  costBasis: number;
  /** Last stored close, or null when none is stored. */
  price: number | null;
  priceDate: string | null;
  beta: number | null;
  sector: string | null;
}

/** One ticker in the book: lots combined (shares added, cost averaged by shares). */
export interface BookPosition {
  ticker: string;
  shares: number;
  costBasis: number;
  price: number;
  priceDate: string | null;
  beta: number | null;
  sector: string | null;
  value: number;
  cost: number;
  /** Unrealized result in USD and as a fraction of cost. */
  usd: number;
  pct: number;
  /** Share of the priced book's value. */
  weight: number;
}

/** Lots combined by ticker and priced at the last close; unpriced tickers are listed, never guessed. */
export function bookPositions(lots: readonly BookLot[]): {
  positions: BookPosition[];
  unpriced: string[];
  value: number;
  cost: number;
} {
  const by = new Map<string, BookLot & { cost: number }>();
  for (const l of lots) {
    const cur = by.get(l.ticker);
    if (!cur) by.set(l.ticker, { ...l, cost: l.shares * l.costBasis });
    else {
      cur.shares += l.shares;
      cur.cost += l.shares * l.costBasis;
      cur.costBasis = cur.cost / cur.shares;
    }
  }
  const unpriced: string[] = [];
  const priced: Omit<BookPosition, 'weight'>[] = [];
  for (const l of by.values()) {
    if (l.price === null || !(l.price > 0)) {
      unpriced.push(l.ticker);
      continue;
    }
    const value = l.shares * l.price;
    priced.push({
      ticker: l.ticker,
      shares: l.shares,
      costBasis: l.costBasis,
      price: l.price,
      priceDate: l.priceDate,
      beta: l.beta,
      sector: l.sector,
      value,
      cost: l.cost,
      usd: value - l.cost,
      pct: value / l.cost - 1,
    });
  }
  const value = priced.reduce((a, p) => a + p.value, 0);
  const cost = priced.reduce((a, p) => a + p.cost, 0);
  return {
    positions: priced
      .map((p) => ({ ...p, weight: value > 0 ? p.value / value : 0 }))
      .sort((a, b) => b.value - a.value),
    unpriced: unpriced.sort(),
    value,
    cost,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Holdings table formulas

/** Sessions from the last close of the previous calendar year to the newest bar; null without such a bar. */
export function ytdSessions(bars: readonly DailyBar[]): number | null {
  const last = bars.at(-1);
  if (!last) return null;
  const jan1 = `${last.date.slice(0, 4)}-01-01`;
  for (let i = bars.length - 1; i >= 0; i--)
    if ((bars[i] as DailyBar).date < jan1) return bars.length - 1 - i;
  return null;
}

export type PeriodKey = 'w1' | 'm1' | 'm3' | 'm6' | 'ytd' | 'y1';

/** The holding's return (and SPY's over the same dates) for each period; null where the bars do not reach. */
export function periodReturns(
  bars: readonly DailyBar[],
  spy: readonly DailyBar[] | null,
): Record<PeriodKey, PeriodReturn | null> {
  const ytd = ytdSessions(bars);
  return {
    w1: periodReturn(bars, PERIOD_SESSIONS.w1, spy, null),
    m1: periodReturn(bars, PERIOD_SESSIONS.m1, spy, null),
    m3: periodReturn(bars, PERIOD_SESSIONS.m3, spy, null),
    m6: periodReturn(bars, PERIOD_SESSIONS.m6, spy, null),
    ytd: ytd === null || ytd === 0 ? null : periodReturn(bars, ytd, spy, null),
    y1: periodReturn(bars, PERIOD_SESSIONS.y1, spy, null),
  };
}

/** The last close against its 50- and 200-day simple averages (fractions) and the 14-day RSI; nulls when short. */
export function priceVsAverages(closes: readonly number[]): {
  close: number | null;
  sma50: number | null;
  sma200: number | null;
  vs50: number | null;
  vs200: number | null;
  rsi14: number | null;
} {
  const close = closes.at(-1) ?? null;
  const s50 = sma(closes, 50).at(-1) ?? null;
  const s200 = sma(closes, 200).at(-1) ?? null;
  const r = rsi(closes, 14).at(-1) ?? null;
  return {
    close,
    sma50: s50,
    sma200: s200,
    vs50: close !== null && s50 ? close / s50 - 1 : null,
    vs200: close !== null && s200 ? close / s200 - 1 : null,
    rsi14: r,
  };
}

/** A stored cash dividend, as the dividend formulas take it. */
export interface PayoutRow {
  ticker: string;
  exDate: string;
  payDate: string | null;
  amount: number;
  /** Payments a year as the vendor states it (4 quarterly, 12 monthly, 0 irregular), or null. */
  frequency: number | null;
  source: 'massive' | 'tauric';
}

export interface TrailingDividends {
  /** Sum of cash per share with ex-dates in the 365 days ending on `asOf`. */
  perShare: number;
  payments: number;
  from: string;
  to: string;
  /** Newest ex-date on or before `asOf`, and the first after it (announced), each or null. */
  latest: PayoutRow | null;
  next: PayoutRow | null;
}

const minusDays = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
const plusDays = (iso: string, days: number) => minusDays(iso, -days);

/** Trailing-twelve-month dividends of one ticker as of a date (the last close). */
export function trailingDividends(rows: readonly PayoutRow[], asOf: string): TrailingDividends {
  const from = minusDays(asOf, 365);
  const sorted = [...rows].sort((a, b) => a.exDate.localeCompare(b.exDate));
  const window = sorted.filter((r) => r.exDate > from && r.exDate <= asOf);
  return {
    perShare: window.reduce((a, r) => a + r.amount, 0),
    payments: window.length,
    from,
    to: asOf,
    latest: [...sorted].reverse().find((r) => r.exDate <= asOf) ?? null,
    next: sorted.find((r) => r.exDate > asOf) ?? null,
  };
}

/** Yield on a price (a fraction); null without a positive price. */
export const dividendYield = (perShare: number, price: number | null): number | null =>
  price !== null && price > 0 ? perShare / price : null;

/** One payment times the stated payments a year; null when the frequency is missing or irregular (0). */
export const annualizedPayment = (amount: number, frequency: number | null): number | null =>
  frequency !== null && frequency > 0 ? amount * frequency : null;

/**
 * Stored Massive dividends and Tauric's calendar dividends combined: one row per ticker and ex-date, the Massive
 * row kept when both exist (it carries the pay date and frequency). Tauric rows without an ex-date or amount drop.
 */
export function mergeDividends(
  massive: readonly PayoutRow[],
  tauric: readonly { ticker: string; exDate: string | null; amount: number | null }[],
): PayoutRow[] {
  const out = new Map<string, PayoutRow>();
  for (const r of massive) out.set(`${r.ticker}|${r.exDate}`, r);
  for (const r of tauric) {
    if (r.exDate === null || r.amount === null) continue;
    const k = `${r.ticker}|${r.exDate}`;
    if (!out.has(k))
      out.set(k, {
        ticker: r.ticker,
        exDate: r.exDate,
        payDate: null,
        amount: r.amount,
        frequency: null,
        source: 'tauric',
      });
  }
  return [...out.values()].sort(
    (a, b) => a.exDate.localeCompare(b.exDate) || a.ticker.localeCompare(b.ticker),
  );
}

/** The book's dividend income from trailing payments, and the yield on the priced value. */
export function portfolioDividends(
  rows: readonly { ticker: string; shares: number; price: number; ttmPerShare: number }[],
): {
  income: number;
  value: number;
  yieldOnValue: number | null;
  payers: { ticker: string; income: number; yield: number; value: number }[];
  nonPayers: string[];
} {
  const value = rows.reduce((a, r) => a + r.shares * r.price, 0);
  const payers = rows
    .filter((r) => r.ttmPerShare > 0)
    .map((r) => ({
      ticker: r.ticker,
      income: r.ttmPerShare * r.shares,
      yield: r.ttmPerShare / r.price,
      value: r.shares * r.price,
    }))
    .sort((a, b) => b.income - a.income);
  const income = payers.reduce((a, p) => a + p.income, 0);
  return {
    income,
    value,
    yieldOnValue: value > 0 ? income / value : null,
    payers,
    nonPayers: rows
      .filter((r) => !(r.ttmPerShare > 0))
      .map((r) => r.ticker)
      .sort(),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Current holdings at today's weights against SPY

export interface MixPoint {
  date: string;
  /** Change since the first date, fractions. */
  portfolio: number;
  spy: number;
}

export interface MixSeries {
  version: string;
  sessions: number;
  from: string;
  to: string;
  points: MixPoint[];
  /** Tickers in the series, and those left out because a close is missing on some date in the span. */
  included: string[];
  leftOut: string[];
}

/**
 * Today's shares of each holding valued at each past close, over the last `sessions` SPY sessions (fewer when
 * fewer are stored), against SPY. This is not the account's history: past buys and sales are not in it. A holding
 * without a close on every date of the span is left out and named. Null when nothing can be included.
 */
export function currentMix(
  holdings: readonly { ticker: string; shares: number }[],
  bars: Readonly<Record<string, readonly DailyBar[]>>,
  sessions: number,
): MixSeries | null {
  const spy = bars['SPY'] ?? [];
  const n = Math.min(sessions, spy.length - 1);
  if (n < 1) return null;
  const span = spy.slice(-(n + 1));
  const shares = new Map<string, number>();
  for (const h of holdings) shares.set(h.ticker, (shares.get(h.ticker) ?? 0) + h.shares);
  const included: string[] = [];
  const leftOut: string[] = [];
  const closes = new Map<string, Map<string, number>>();
  for (const t of [...shares.keys()].sort()) {
    const m = new Map((bars[t] ?? []).map((b) => [b.date, b.close]));
    if (span.every((s) => (m.get(s.date) ?? 0) > 0)) {
      included.push(t);
      closes.set(t, m);
    } else leftOut.push(t);
  }
  if (included.length === 0) return null;
  const valueOn = (date: string) =>
    included.reduce(
      (a, t) => a + (shares.get(t) as number) * (closes.get(t)?.get(date) as number),
      0,
    );
  const v0 = valueOn((span[0] as DailyBar).date);
  const s0 = (span[0] as DailyBar).close;
  return {
    version: PORTFOLIO_CHECK_VERSION,
    sessions: n,
    from: (span[0] as DailyBar).date,
    to: (span.at(-1) as DailyBar).date,
    points: span.map((s) => ({
      date: s.date,
      portfolio: valueOn(s.date) / v0 - 1,
      spy: s.close / s0 - 1,
    })),
    included,
    leftOut,
  };
}

/** Fewer daily returns than this and volatility is not reported. */
export const MIN_VOL_RETURNS = 60;

/** Annualized volatility (sample deviation of daily returns times the square root of 252) and the largest fall. */
export function mixRisk(mix: MixSeries): {
  volatility: number | null;
  maxDrawdown: number;
  returns: number;
} {
  const r: number[] = [];
  for (let i = 1; i < mix.points.length; i++)
    r.push(
      (1 + (mix.points[i] as MixPoint).portfolio) /
        (1 + (mix.points[i - 1] as MixPoint).portfolio) -
        1,
    );
  return {
    volatility: r.length >= MIN_VOL_RETURNS ? stdev(r) * Math.sqrt(TRADING_DAYS) : null,
    maxDrawdown: maxDrawdown(r),
    returns: r.length,
  };
}

/**
 * Calendar-month changes of the mix and SPY: each month's last point against the previous month's last point. The
 * first month starts at the series start and the newest runs to the last stored date, so both are marked partial
 * and carry their `from` and `to` dates.
 */
export function monthlyReturns(
  mix: MixSeries,
): { month: string; portfolio: number; spy: number; from: string; to: string; partial: boolean }[] {
  const ends = new Map<string, MixPoint>();
  for (const p of mix.points) ends.set(p.date.slice(0, 7), p);
  const months = [...ends.keys()].sort();
  const first = mix.points[0] as MixPoint;
  return months.map((m, i) => {
    const prev = i === 0 ? first : (ends.get(months[i - 1] as string) as MixPoint);
    const end = ends.get(m) as MixPoint;
    return {
      month: m,
      portfolio: (1 + end.portfolio) / (1 + prev.portfolio) - 1,
      spy: (1 + end.spy) / (1 + prev.spy) - 1,
      from: prev.date,
      to: end.date,
      partial: i === 0 || i === months.length - 1,
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// The check

/** Within, past the limit, not computable, or no limit set (a member before setting any). */
export type LimitState = 'within' | 'above' | 'unavailable' | 'unset';

export interface CheckRow {
  id:
    | 'largest'
    | 'top5'
    | 'beta'
    | 'cash'
    | 'open-risk'
    | 'sector'
    | 'volatility'
    | 'drawdown'
    | 'below-cost';
  /** 'limit': one of the person's limits (`PortfolioLimits`); 'rule': one of Marsad's check rules. */
  kind: 'limit' | 'rule';
  /** The measured value (fraction, or beta), or null when it cannot be computed. */
  value: number | null;
  /** Null when no limit is set. */
  limit: number | null;
  /** True for a minimum (cash): a value under the limit is the breach. */
  minimum: boolean;
  state: LimitState;
  /** The ticker or sector the row is about, when it names one. */
  subject: string | null;
}

export interface SectorWeight {
  sector: string;
  value: number;
  weight: number;
  tickers: string[];
}

export interface PortfolioCheck {
  version: string;
  asOf: string | null;
  count: number;
  value: number;
  cost: number;
  /** Priced value plus cash when cash is tracked; the base of every "share of equity". */
  equity: number;
  unpriced: string[];
  concentration: {
    /** Weights are shares of equity. */
    largest: { ticker: string; weight: number } | null;
    top3: number;
    top5: number;
    hhi: number;
    effectivePositions: number;
  };
  sectors: SectorWeight[];
  risk: {
    beta: number | null;
    betaAssumed: string[];
    volatility: number | null;
    maxDrawdown: number | null;
    /** The span the volatility and drawdown cover. */
    span: { from: string; to: string; sessions: number } | null;
    /** Open risk to the stops as a share of equity, and the holdings whose risk is unknown (no stop). */
    openRisk: { pct: number | null; unknown: string[] } | null;
  };
  performance: {
    rows: { ticker: string; usd: number; pct: number }[];
    usd: number;
    pct: number | null;
    belowCost: number;
    belowCostShare: number | null;
  };
  /** Cash in USD, or null when Marsad does not track it. */
  cash: number | null;
  rows: CheckRow[];
}

export const UNCLASSIFIED = 'Unclassified';

const stateOf = (value: number | null, limit: number | null, minimum = false): LimitState =>
  limit === null
    ? 'unset'
    : value === null
      ? 'unavailable'
      : (minimum ? value < limit : value > limit)
        ? 'above'
        : 'within';

/** Groups positions by a label (null is "Unclassified"), largest value first. */
export function groupPositions(
  positions: readonly BookPosition[],
  labelOf: (p: BookPosition) => string | null,
): {
  label: string;
  value: number;
  cost: number;
  usd: number;
  pct: number;
  weight: number;
  positions: BookPosition[];
}[] {
  const total = positions.reduce((a, p) => a + p.value, 0);
  const by = new Map<string, BookPosition[]>();
  for (const p of positions) {
    const k = labelOf(p) ?? UNCLASSIFIED;
    by.set(k, [...(by.get(k) ?? []), p]);
  }
  return [...by.entries()]
    .map(([label, ps]) => {
      const value = ps.reduce((a, p) => a + p.value, 0);
      const cost = ps.reduce((a, p) => a + p.cost, 0);
      return {
        label,
        value,
        cost,
        usd: value - cost,
        pct: cost > 0 ? value / cost - 1 : 0,
        weight: total > 0 ? value / total : 0,
        positions: [...ps].sort((a, b) => b.value - a.value),
      };
    })
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

/**
 * The check: the person's limits (largest position, top 5, beta, minimum cash, open risk) and Marsad's check rules
 * (largest sector, volatility, largest fall, positions below cost), each with its state. Shares are of equity:
 * priced value plus cash when cash is tracked. Cash not tracked makes the cash row unavailable, never zero.
 */
export function portfolioCheck(x: {
  lots: readonly BookLot[];
  mix: MixSeries | null;
  cash: number | null;
  limits: PortfolioLimits;
  /** From `exitReview`: open risk over equity and the tickers without a stop. */
  openRisk?: { pct: number | null; unknown: string[] } | null;
}): PortfolioCheck {
  const book = bookPositions(x.lots);
  const ps = book.positions;
  const ex =
    ps.length > 0
      ? exposureReport(
          ps.map((p) => ({
            ticker: p.ticker,
            shares: p.shares,
            price: p.price,
            sectorEtf: null,
            beta: p.beta,
            vixSensitivity: null,
            sectorBeta: null,
          })),
        )
      : null;
  const equity = book.value + (x.cash ?? 0);
  const scale = equity > 0 ? book.value / equity : 0;
  const sectors: SectorWeight[] = groupPositions(ps, (p) => p.sector).map((g) => ({
    sector: g.label,
    value: g.value,
    weight: g.weight * scale,
    tickers: g.positions.map((p) => p.ticker),
  }));
  const risk = x.mix ? mixRisk(x.mix) : null;
  const belowCost = ps.filter((p) => p.price < p.costBasis).length;
  const L = x.limits;
  const R = CHECK_RULES;
  const lg = ex?.concentration.largest ?? null;
  const largest = lg ? { ticker: lg.ticker, weight: lg.weight * scale } : null;
  const top3 = (ex?.concentration.top3Weight ?? 0) * scale;
  const top5 = ps.slice(0, 5).reduce((a, p) => a + p.weight, 0) * scale;
  const topSector = sectors[0] ?? null;
  const vol = risk?.volatility ?? null;
  const dd = risk ? risk.maxDrawdown : null;
  const has = ps.length > 0;
  const cashShare = x.cash !== null && equity > 0 ? x.cash / equity : null;
  const open = x.openRisk ?? null;
  const row = (
    id: CheckRow['id'],
    kind: CheckRow['kind'],
    value: number | null,
    limit: number | null,
    subject: string | null = null,
    minimum = false,
    compared: number | null = value,
  ): CheckRow => ({
    id,
    kind,
    value,
    limit,
    minimum,
    state: stateOf(compared, limit, minimum),
    subject,
  });
  const rows: CheckRow[] = [
    row('largest', 'limit', largest?.weight ?? null, L.largestPosition, largest?.ticker ?? null),
    row('top5', 'limit', has ? top5 : null, L.top5),
    row('beta', 'limit', ex?.portfolioBeta ?? null, L.portfolioBeta),
    row('cash', 'limit', cashShare, L.minCash, null, true),
    row('open-risk', 'limit', open?.pct ?? null, L.openRisk),
    row('sector', 'rule', topSector?.weight ?? null, R.sector, topSector?.sector ?? null),
    row('volatility', 'rule', vol, R.volatility),
    row('drawdown', 'rule', dd, R.drawdown, null, false, dd === null ? null : -dd),
    row('below-cost', 'rule', has ? belowCost / ps.length : null, R.belowCostShare),
  ];
  const asOf = ps.map((p) => p.priceDate ?? '').reduce((a, b) => (b > a ? b : a), '') || null;
  return {
    version: PORTFOLIO_CHECK_VERSION,
    asOf,
    count: ps.length,
    value: book.value,
    cost: book.cost,
    equity,
    unpriced: book.unpriced,
    concentration: {
      largest,
      top3,
      top5,
      hhi: ex?.concentration.hhi ?? 0,
      effectivePositions: ex?.concentration.effectivePositions ?? 0,
    },
    sectors,
    risk: {
      beta: ex?.portfolioBeta ?? null,
      betaAssumed: ex?.betaAssumed ?? [],
      volatility: vol,
      maxDrawdown: dd,
      span: x.mix ? { from: x.mix.from, to: x.mix.to, sessions: x.mix.sessions } : null,
      openRisk: open,
    },
    performance: {
      rows: [...ps]
        .sort((a, b) => b.usd - a.usd)
        .map((p) => ({ ticker: p.ticker, usd: p.usd, pct: p.pct })),
      usd: book.value - book.cost,
      pct: book.cost > 0 ? book.value / book.cost - 1 : null,
      belowCost,
      belowCostShare: has ? belowCost / ps.length : null,
    },
    cash: x.cash,
    rows,
  };
}

/** The limit rows in breach, each with its figures (the page writes them as text, never as a block or advice). */
export const limitBreaches = (c: PortfolioCheck): CheckRow[] =>
  c.rows.filter((r) => r.kind === 'limit' && r.state === 'above');

const pct1 = (v: number) => `${v < 0 ? '−' : ''}${toFixedHalfUp(Math.abs(v) * 100, 1)}%`;
const signedPct1 = (v: number) => `${v < 0 ? '−' : '+'}${toFixedHalfUp(Math.abs(v) * 100, 1)}%`;
const usd0 = (v: number) =>
  `${v < 0 ? '−' : ''}$${Math.round(Math.abs(v)).toLocaleString('en-US')}`;
const signedUsd0 = (v: number) => `${v < 0 ? '−' : '+'}${usd0(Math.abs(v))}`;

const LIMIT_NAMES: Record<CheckRow['id'], string> = {
  largest: 'largest position',
  top5: 'top 5 positions',
  beta: 'portfolio beta',
  cash: 'cash',
  'open-risk': 'open risk',
  sector: 'largest sector',
  volatility: 'volatility',
  drawdown: 'largest fall',
  'below-cost': 'positions below cost',
};
const fig = (r: CheckRow, v: number) => (r.id === 'beta' ? toFixedHalfUp(v, 2) : pct1(v));

/**
 * The paragraph under the check, written by code from the numbers above it: facts and the stated limits only,
 * no forecast and no instruction. The page labels it "Written by Marsad from the numbers above".
 */
export function checkNarrative(c: PortfolioCheck): string {
  if (c.count === 0) return 'No priced holdings: there is nothing to check yet.';
  const parts: string[] = [];
  parts.push(
    `The book holds ${c.count} priced position${c.count === 1 ? '' : 's'} worth ${usd0(c.value)} at the close of ${c.asOf ?? 'the last stored session'}.`,
  );
  if (c.unpriced.length > 0)
    parts.push(
      `${c.unpriced.join(', ')} ${c.unpriced.length === 1 ? 'has' : 'have'} no stored close and ${c.unpriced.length === 1 ? 'is' : 'are'} left out.`,
    );
  const lg = c.concentration.largest;
  if (lg)
    parts.push(
      `The largest position, ${lg.ticker}, is ${pct1(lg.weight)} of equity; the top five are ${pct1(c.concentration.top5)}.`,
    );
  const s = c.sectors[0];
  if (s) parts.push(`The largest sector group is ${s.sector} at ${pct1(s.weight)}.`);
  if (c.risk.beta !== null)
    parts.push(`Value-weighted beta to SPY is ${toFixedHalfUp(c.risk.beta, 2)}.`);
  if (c.risk.span && c.risk.maxDrawdown !== null)
    parts.push(
      `Over the last ${c.risk.span.sessions} sessions the current mix had ${c.risk.volatility === null ? 'too few sessions for a volatility figure' : `an annualized volatility of ${pct1(c.risk.volatility)}`} and a largest fall of ${pct1(Math.abs(c.risk.maxDrawdown))}.`,
    );
  if (c.performance.pct !== null)
    parts.push(
      `The open result is ${signedUsd0(c.performance.usd)} (${signedPct1(c.performance.pct)}) on cost; ${c.performance.belowCost} of ${c.count} positions are below cost.`,
    );
  parts.push(c.cash === null ? 'Cash is not tracked.' : `Cash is ${usd0(c.cash)}.`);
  const set = c.rows.filter((r) => r.kind === 'limit' && r.state !== 'unset');
  const breaches = limitBreaches(c);
  if (set.length === 0) parts.push('No limits are set.');
  else if (breaches.length === 0) parts.push('No limit is breached.');
  else
    parts.push(
      `Past your limits: ${breaches
        .map(
          (r) =>
            `${LIMIT_NAMES[r.id]} ${fig(r, r.value as number)} (limit ${r.minimum ? 'at least ' : ''}${fig(r, r.limit as number)})`,
        )
        .join('; ')}.`,
    );
  const rules = c.rows.filter((r) => r.kind === 'rule' && r.state === 'above');
  if (rules.length > 0)
    parts.push(`Past Marsad’s check rules: ${rules.map((r) => LIMIT_NAMES[r.id]).join(', ')}.`);
  return parts.join(' ');
}

// ---------------------------------------------------------------------------------------------------------------
// Needs attention

export type CardState = 'above' | 'note' | 'positive';

export interface AttentionCard {
  id: 'down-from-cost' | 'loss-share' | 'high-beta' | 'book-loss' | 'biggest-gainer';
  state: CardState;
  /** Whether the rule fired. Every rule is returned so the page can list those that did not. */
  met: boolean;
  tickers: string[];
  /** The dollar figure the card shows (a loss is negative). */
  usd: number;
  /** The rule's measured value: a fraction, or a count of positions for high beta. */
  value: number | null;
  limit: number;
  /** Combined weight of the named positions. */
  weight: number;
}

/**
 * The "Needs attention" rules over the priced book, each with its numbers. A card states the fact and the rule; the
 * page adds each named position's own exit condition and nothing else (ADR 0048: no analyst-target card, because
 * upside beside a loss makes holding a loser feel justified).
 */
export function needsAttention(positions: readonly BookPosition[]): AttentionCard[] {
  const L = CHECK_RULES;
  const sum = (ps: readonly BookPosition[], f: (p: BookPosition) => number) =>
    ps.reduce((a, p) => a + f(p), 0);
  const card = (
    id: AttentionCard['id'],
    state: CardState,
    ps: readonly BookPosition[],
    usd: number,
    value: number | null,
    limit: number,
  ): AttentionCard => ({
    id,
    state,
    met: ps.length > 0,
    tickers: ps.map((p) => p.ticker),
    usd,
    value,
    limit,
    weight: sum(ps, (p) => p.weight),
  });
  const down = positions.filter((p) => p.pct <= -L.downFromCost);
  const totalLoss = sum(
    positions.filter((p) => p.usd < 0),
    (p) => p.usd,
  );
  const heavy =
    totalLoss < 0 ? positions.filter((p) => p.usd < 0 && p.usd / totalLoss > L.lossShare) : [];
  const highBeta = positions.filter((p) => p.beta !== null && p.beta > L.highBeta);
  const value = sum(positions, (p) => p.value);
  const cost = sum(positions, (p) => p.cost);
  const book = cost > 0 ? value / cost - 1 : null;
  const best = [...positions].sort((a, b) => b.usd - a.usd)[0];
  const gainer = best && best.usd > 0 ? [best] : [];
  return [
    card(
      'down-from-cost',
      'above',
      down,
      sum(down, (p) => p.usd),
      down.length ? Math.min(...down.map((p) => p.pct)) : null,
      L.downFromCost,
    ),
    card(
      'loss-share',
      'above',
      heavy,
      sum(heavy, (p) => p.usd),
      heavy.length ? Math.max(...heavy.map((p) => p.usd / totalLoss)) : null,
      L.lossShare,
    ),
    card(
      'high-beta',
      'note',
      highBeta,
      sum(highBeta, (p) => p.value),
      highBeta.length,
      L.highBeta,
    ),
    {
      ...card('book-loss', 'above', [], value - cost, book, L.bookLoss),
      met: book !== null && book < -L.bookLoss,
      tickers: book !== null && book < -L.bookLoss ? positions.map((p) => p.ticker) : [],
    },
    card('biggest-gainer', 'positive', gainer, best?.usd ?? 0, best ? best.pct : null, 0),
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Distribution and valuation

export type Dimension = 'sector' | 'marketCap' | 'dividend' | 'beta' | 'pe';

const bucket = (
  edges: readonly { key: string; below: number }[],
  v: number | null,
  missing: string,
): string => {
  if (v === null || !Number.isFinite(v)) return missing;
  return edges.find((e) => v < e.below)?.key ?? missing;
};

export const marketCapBucket = (v: number | null) =>
  bucket(DISTRIBUTION_BUCKETS.marketCap, v !== null && v > 0 ? v : null, 'unavailable');
export const betaBucket = (v: number | null) => bucket(DISTRIBUTION_BUCKETS.beta, v, 'unavailable');
export const peBucket = (v: number | null) =>
  bucket(DISTRIBUTION_BUCKETS.pe, v !== null && v > 0 ? v : null, 'not-meaningful');

/** Weight and count per bucket key, with the slice's holdings by value; largest slice first. */
export function distribution(
  rows: readonly { ticker: string; value: number; key: string }[],
): { key: string; value: number; weight: number; count: number; tickers: string[] }[] {
  const total = rows.reduce((a, r) => a + r.value, 0);
  const by = new Map<string, { ticker: string; value: number }[]>();
  for (const r of rows) by.set(r.key, [...(by.get(r.key) ?? []), r]);
  return [...by.entries()]
    .map(([key, rs]) => {
      const value = rs.reduce((a, r) => a + r.value, 0);
      return {
        key,
        value,
        weight: total > 0 ? value / total : 0,
        count: rs.length,
        tickers: [...rs].sort((a, b) => b.value - a.value).map((r) => r.ticker),
      };
    })
    .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
}

/**
 * Portfolio P/E: the value-weighted harmonic mean of the positive P/Es, sum(value) / sum(value / pe), the same as
 * total value over total earnings bought. Negative, zero or missing P/Es are "not meaningful" and left out.
 */
export function portfolioPe(
  rows: readonly { ticker: string; value: number; pe: number | null }[],
): {
  pe: number | null;
  included: { ticker: string; pe: number; value: number }[];
  notMeaningful: string[];
  /** Share of the value the figure covers. */
  coverage: number;
} {
  const included = rows
    .filter((r): r is { ticker: string; value: number; pe: number } => r.pe !== null && r.pe > 0)
    .filter((r) => r.value > 0);
  const v = included.reduce((a, r) => a + r.value, 0);
  const e = included.reduce((a, r) => a + r.value / r.pe, 0);
  const total = rows.reduce((a, r) => a + r.value, 0);
  return {
    pe: e > 0 ? v / e : null,
    included: [...included].sort((a, b) => b.pe - a.pe),
    notMeaningful: rows
      .filter((r) => !(r.pe !== null && r.pe > 0))
      .map((r) => r.ticker)
      .sort(),
    coverage: total > 0 ? v / total : 0,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Trades, activity and moves

/** Return of a closed trade on its entry price (sign flipped for a short); null while open. */
export function tradeReturn(t: JournalTrade): number | null {
  if (t.exitPrice === null || !(t.entryPrice > 0)) return null;
  const r = t.exitPrice / t.entryPrice - 1;
  return t.side === 'short' ? -r : r;
}

/**
 * Closed-trade summary. With fewer than 30 closed trades no percentage is given (CLAUDE.md): the counts stay, the
 * win rate and mean return are null and `insufficient` is true.
 */
export function closedTradeSummary(trades: readonly JournalTrade[]): {
  closed: number;
  profitable: number;
  winRate: number | null;
  meanReturn: number | null;
  insufficient: boolean;
} {
  const all = statsBySetup(trades)[0];
  const closed = all?.closed ?? 0;
  const profitable = all?.wins ?? 0;
  const rs = trades.map(tradeReturn).filter((r): r is number => r !== null);
  const insufficient = closed < MIN_CASES;
  return {
    closed,
    profitable,
    winRate: insufficient ? null : profitable / closed,
    meanReturn: insufficient || rs.length === 0 ? null : rs.reduce((a, b) => a + b, 0) / rs.length,
    insufficient,
  };
}

export type ActivityKind = 'opened' | 'added' | 'closed';

export interface ActivityRow {
  ticker: string;
  transactions: number;
  lastAction: ActivityKind;
  lastDate: string;
  /** The newest closed trade's return, or null. */
  lastClosedReturn: number | null;
  realizedUsd: number;
}

/**
 * Activity by ticker from the Journal: each trade's entry ("Opened", or "Added" when a position in the ticker was
 * already open) and exit ("Closed"), plus open holdings lots with no trade on the same ticker and date. Newest
 * first. Facts about what was recorded, never a suggestion.
 */
export function recentActivity(
  trades: readonly JournalTrade[],
  lots: readonly { ticker: string; openedOn: string }[],
): ActivityRow[] {
  type Ev = { ticker: string; date: string; kind: 'in' | 'out'; t: JournalTrade | null };
  const evs: Ev[] = [];
  for (const t of trades) {
    evs.push({ ticker: t.ticker, date: t.entryDate, kind: 'in', t });
    if (t.exitDate !== null) evs.push({ ticker: t.ticker, date: t.exitDate, kind: 'out', t });
  }
  for (const l of lots)
    if (!trades.some((t) => t.ticker === l.ticker && t.entryDate === l.openedOn))
      evs.push({ ticker: l.ticker, date: l.openedOn, kind: 'in', t: null });
  // Same day: entries before exits, so an intraday round trip reads Opened then Closed.
  evs.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'in' ? -1 : 1));
  const open = new Map<string, number>();
  const out = new Map<string, ActivityRow>();
  for (const e of evs) {
    const n = open.get(e.ticker) ?? 0;
    const kind: ActivityKind = e.kind === 'out' ? 'closed' : n > 0 ? 'added' : 'opened';
    open.set(e.ticker, Math.max(0, n + (e.kind === 'in' ? 1 : -1)));
    const row = out.get(e.ticker) ?? {
      ticker: e.ticker,
      transactions: 0,
      lastAction: kind,
      lastDate: e.date,
      lastClosedReturn: null,
      realizedUsd: 0,
    };
    row.transactions += 1;
    row.lastAction = kind;
    row.lastDate = e.date;
    if (e.kind === 'out' && e.t) {
      row.lastClosedReturn = tradeReturn(e.t);
      row.realizedUsd += pnl(e.t) ?? 0;
    }
    out.set(e.ticker, row);
  }
  return [...out.values()].sort(
    (a, b) => b.lastDate.localeCompare(a.lastDate) || a.ticker.localeCompare(b.ticker),
  );
}

/** Holdings whose close moved more than the limit over the last `sessions` stored sessions, largest move first. */
export function weeklyMoves(
  tickers: readonly string[],
  bars: Readonly<Record<string, readonly DailyBar[]>>,
  limit: number = CHECK_RULES.weeklyMove,
  sessions: number = PERIOD_SESSIONS.w1,
): {
  ticker: string;
  from: string;
  to: string;
  fromClose: number;
  toClose: number;
  change: number;
}[] {
  return [...new Set(tickers)]
    .flatMap((t) => {
      const b = bars[t] ?? [];
      const end = b.at(-1);
      const start = b[b.length - 1 - sessions];
      if (!end || !start || !(start.close > 0)) return [];
      const change = end.close / start.close - 1;
      return Math.abs(change) > limit
        ? [
            {
              ticker: t,
              from: start.date,
              to: end.date,
              fromClose: start.close,
              toClose: end.close,
              change,
            },
          ]
        : [];
    })
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change) || a.ticker.localeCompare(b.ticker));
}

// ---------------------------------------------------------------------------------------------------------------
// Coming up

export type ComingKind = 'earnings' | 'ex-dividend' | 'catalyst';

export interface ComingEvent {
  date: string;
  ticker: string;
  kind: ComingKind;
  /** Which source and basis: Tauric's calendar, Marsad's estimate from filings, Massive, or the Tauric thesis. */
  source: 'tauric-calendar' | 'marsad-estimate' | 'massive' | 'tauric-thesis';
  /** EPS estimate or dividend amount, or null. */
  amount: number | null;
  /** Catalyst text and its timing words, or null. */
  text: string | null;
  timing: string | null;
  /** True for Marsad's estimated earnings date (never a confirmed date). */
  estimated: boolean;
}

/**
 * The dated events of the next `days` calendar days for the holdings, oldest first. Earnings: Tauric's stated date
 * wins over Marsad's estimate for the same ticker. Dividends: merged as `mergeDividends`. Catalysts without a date
 * are counted, not placed.
 */
export function comingUp(x: {
  today: string;
  days?: number;
  earnings: readonly {
    ticker: string;
    date: string;
    eps: number | null;
    source: 'tauric-calendar' | 'marsad-estimate';
  }[];
  dividends: readonly PayoutRow[];
  catalysts: readonly {
    ticker: string;
    date: string | null;
    text: string;
    timing: string | null;
  }[];
}): { events: ComingEvent[]; undatedCatalysts: number; to: string } {
  const to = plusDays(x.today, x.days ?? CHECK_RULES.comingUpDays);
  const inside = (d: string) => d >= x.today && d <= to;
  const events: ComingEvent[] = [];
  const stated = new Set(
    x.earnings.filter((e) => e.source === 'tauric-calendar').map((e) => e.ticker),
  );
  for (const e of x.earnings) {
    if (!inside(e.date)) continue;
    if (e.source === 'marsad-estimate' && stated.has(e.ticker)) continue;
    events.push({
      date: e.date,
      ticker: e.ticker,
      kind: 'earnings',
      source: e.source,
      amount: e.eps,
      text: null,
      timing: null,
      estimated: e.source === 'marsad-estimate',
    });
  }
  for (const d of x.dividends)
    if (inside(d.exDate))
      events.push({
        date: d.exDate,
        ticker: d.ticker,
        kind: 'ex-dividend',
        source: d.source === 'massive' ? 'massive' : 'tauric-calendar',
        amount: d.amount,
        text: null,
        timing: null,
        estimated: false,
      });
  let undated = 0;
  for (const c of x.catalysts) {
    if (c.date === null) {
      undated += 1;
      continue;
    }
    if (inside(c.date))
      events.push({
        date: c.date,
        ticker: c.ticker,
        kind: 'catalyst',
        source: 'tauric-thesis',
        amount: null,
        text: c.text,
        timing: c.timing,
        estimated: false,
      });
  }
  const order: Record<ComingKind, number> = { earnings: 0, 'ex-dividend': 1, catalyst: 2 };
  events.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      order[a.kind] - order[b.kind] ||
      a.ticker.localeCompare(b.ticker),
  );
  return { events, undatedCatalysts: undated, to };
}

/** Days from today to a date (negative when past). */
export const daysUntil = (today: string, date: string) => daysBetween(today, date);

/**
 * The last session's change of each holding (its newest close against the one before) and of the book: the sum of
 * shares times the change, over the value at the previous closes. Holdings with fewer than two closes are listed.
 * Up to three gainers and three losers by percentage.
 */
export function dayMoves(
  holdings: readonly { ticker: string; shares: number }[],
  bars: Readonly<Record<string, readonly DailyBar[]>>,
): {
  usd: number;
  pct: number | null;
  rows: { ticker: string; date: string; prevDate: string; change: number; usd: number }[];
  gainers: string[];
  losers: string[];
  missing: string[];
} {
  const shares = new Map<string, number>();
  for (const h of holdings) shares.set(h.ticker, (shares.get(h.ticker) ?? 0) + h.shares);
  const rows: { ticker: string; date: string; prevDate: string; change: number; usd: number }[] =
    [];
  const missing: string[] = [];
  let prevValue = 0;
  for (const [ticker, n] of [...shares.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const b = bars[ticker] ?? [];
    const end = b.at(-1);
    const prev = b.at(-2);
    if (!end || !prev || !(prev.close > 0)) {
      missing.push(ticker);
      continue;
    }
    prevValue += n * prev.close;
    rows.push({
      ticker,
      date: end.date,
      prevDate: prev.date,
      change: end.close / prev.close - 1,
      usd: n * (end.close - prev.close),
    });
  }
  const usd = rows.reduce((a, r) => a + r.usd, 0);
  const byPct = [...rows].sort((a, b) => b.change - a.change || a.ticker.localeCompare(b.ticker));
  return {
    usd,
    pct: prevValue > 0 ? usd / prevValue : null,
    rows,
    gainers: byPct
      .filter((r) => r.change > 0)
      .slice(0, 3)
      .map((r) => r.ticker),
    losers: [...byPct]
      .reverse()
      .filter((r) => r.change < 0)
      .slice(0, 3)
      .map((r) => r.ticker),
    missing,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Review (the Portfolio page's first view, ADR 0048)

export interface ReviewRow {
  id: number;
  ticker: string;
  shares: number;
  price: number | null;
  priceDate: string | null;
  hasRules: boolean;
  /** Exit conditions met at the newest close (`exitSignals`). */
  signals: ExitSignal[];
  stop: number | null;
  /** `gapToStop`: price / stop - 1; negative once the close is under the stop. */
  stopGap: number | null;
  atr: number | null;
  /** (price - stop) / ATR 14. */
  stopAtrs: number | null;
  /** Shares times (price - stop), never below zero; null without a stop or a price. */
  riskUsd: number | null;
  value: number | null;
  /** Value over the sizer cap (equity times `sizerCap`). */
  sizeVsCap: number | null;
  sessions: number;
  nextEarnings: { date: string; estimated: boolean } | null;
  /** The sizer at today's close and stop: shares allowed, or why it cannot size. Null without a stop or price. */
  sizer: { shares: number; capped: boolean } | { error: string } | null;
}

const hasExitRules = (h: Holding) =>
  h.stop !== null || h.targets.length > 0 || h.trendBreak !== null || !!h.timeStopSessions;

/**
 * Each holding lot against its own exit plan: conditions met, distance to the stop (as a fraction and in ATRs),
 * dollars at risk to the stop, size against the sizer cap, sessions held, the next earnings date and what the
 * sizer would allow at today's close and stop. Equity is the priced holdings value (cash is not tracked). Lots
 * without exit rules come first, then those with a condition met, then by dollars at risk.
 */
export function exitReview(x: {
  lots: readonly (Holding & { id: number })[];
  bars: Readonly<Record<string, readonly DailyBar[]>>;
  earnings: Readonly<Record<string, { date: string; estimated: boolean } | null>>;
  riskPct?: number;
  cap?: number;
}): {
  equity: number;
  openRisk: number;
  openRiskPct: number | null;
  noStop: string[];
  rows: ReviewRow[];
} {
  const riskPct = x.riskPct ?? CHECK_RULES.sizerRisk;
  const cap = x.cap ?? CHECK_RULES.sizerCap;
  const equity = x.lots.reduce((a, h) => {
    const c = x.bars[h.ticker]?.at(-1)?.close;
    return a + (c !== undefined && c > 0 ? c * h.shares : 0);
  }, 0);
  const rows: ReviewRow[] = x.lots.map((h) => {
    const b = x.bars[h.ticker] ?? [];
    const last = b.at(-1) ?? null;
    const price = last && last.close > 0 ? last.close : null;
    const a =
      atr(
        b.map((y) => y.high),
        b.map((y) => y.low),
        b.map((y) => y.close),
        14,
      ).at(-1) ?? null;
    const stop = h.stop;
    let sizer: ReviewRow['sizer'] = null;
    if (price !== null && stop !== null && equity > 0) {
      const r = positionSize({ account: equity, riskPct, entry: price, stop, maxPositionPct: cap });
      sizer = 'error' in r ? r : { shares: r.shares, capped: r.capped };
    }
    return {
      id: h.id,
      ticker: h.ticker,
      shares: h.shares,
      price,
      priceDate: last?.date ?? null,
      hasRules: hasExitRules(h),
      signals: exitSignals(h, b),
      stop,
      stopGap: price !== null && stop !== null ? gapToStop(price, stop) : null,
      atr: a,
      stopAtrs: price !== null && stop !== null && a !== null && a > 0 ? (price - stop) / a : null,
      riskUsd: price !== null && stop !== null ? Math.max(0, price - stop) * h.shares : null,
      value: price === null ? null : price * h.shares,
      sizeVsCap: price !== null && equity > 0 ? (price * h.shares) / (equity * cap) : null,
      sessions: sessionsHeld(b, h.openedOn),
      nextEarnings: x.earnings[h.ticker] ?? null,
      sizer,
    };
  });
  rows.sort(
    (p, q) =>
      Number(p.hasRules) - Number(q.hasRules) ||
      Number(q.signals.length > 0) - Number(p.signals.length > 0) ||
      (q.riskUsd ?? -1) - (p.riskUsd ?? -1) ||
      p.ticker.localeCompare(q.ticker),
  );
  const openRisk = rows.reduce((s, r) => s + (r.riskUsd ?? 0), 0);
  return {
    equity,
    openRisk,
    openRiskPct: equity > 0 ? openRisk / equity : null,
    noStop: [...new Set(rows.filter((r) => r.stop === null).map((r) => r.ticker))].sort(),
    rows,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Performance in R (ADR 0048)

/** Weekdays after `from` up to and including `to` (exchange holidays are not removed). */
export function weekdaysBetween(from: string, to: string): number {
  let n = 0;
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = Date.parse(`${from}T00:00:00Z`) + 86_400_000; t <= end; t += 86_400_000) {
    const d = new Date(t).getUTCDay();
    if (d !== 0 && d !== 6) n += 1;
  }
  return n;
}

const avg = (xs: readonly number[]) =>
  xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Closed trades in R: expectancy (mean R of closed trades with a stop), mean R of winners and of losers, mean
 * weekdays held by winners and by losers, and the adherence split (`adherenceVsResult`). Below 30 closed trades
 * only the counts are given: every mean is null and `insufficient` is true (CLAUDE.md, ADR 0048).
 */
export function rPerformance(trades: readonly JournalTrade[]): {
  closed: number;
  winners: number;
  losers: number;
  flat: number;
  withR: number;
  insufficient: boolean;
  expectancyR: number | null;
  avgWinR: number | null;
  avgLossR: number | null;
  winnerDays: number | null;
  loserDays: number | null;
  adherence: ReturnType<typeof adherenceVsResult>;
} {
  const closed = trades.filter((t) => t.exitDate !== null && t.exitPrice !== null);
  const win = closed.filter((t) => (pnl(t) ?? 0) > 0);
  const loss = closed.filter((t) => (pnl(t) ?? 0) < 0);
  const rOf = (ts: readonly JournalTrade[]) =>
    ts.map(rMultiple).filter((r): r is number => r !== null);
  const days = (ts: readonly JournalTrade[]) =>
    ts.map((t) => weekdaysBetween(t.entryDate, t.exitDate as string));
  const insufficient = closed.length < MIN_CASES;
  const gate = (v: number | null) => (insufficient ? null : v);
  return {
    closed: closed.length,
    winners: win.length,
    losers: loss.length,
    flat: closed.length - win.length - loss.length,
    withR: rOf(closed).length,
    insufficient,
    expectancyR: gate(avg(rOf(closed))),
    avgWinR: gate(avg(rOf(win))),
    avgLossR: gate(avg(rOf(loss))),
    winnerDays: gate(avg(days(win))),
    loserDays: gate(avg(days(loss))),
    adherence: adherenceVsResult(trades),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Income (ADR 0048)

export interface IncomeRow {
  ticker: string;
  shares: number;
  /** Forward 12-month cash per share, and how it was found. */
  perShare: number;
  basis: 'stated-frequency' | 'trailing-12m' | 'none';
  /** The payment the forward figure rests on (the newest in the trailing window for trailing-12m), or null. */
  from: PayoutRow | null;
  gross: number;
  net: number;
  yieldOnCost: number | null;
  yieldOnPrice: number | null;
}

/**
 * Forward 12-month dividend income by holding: the newest stored payment (announced or paid) times its stated
 * payments a year; without a stated frequency, the trailing 12 months; net of withholding. Yield on cost uses the
 * average cost per share. No growth and no price change are assumed.
 */
export function forwardIncome(
  rows: readonly {
    ticker: string;
    shares: number;
    price: number;
    costBasis: number;
    payouts: readonly PayoutRow[];
  }[],
  asOf: string,
  withholding: number = DIVIDEND_WITHHOLDING,
): {
  rows: IncomeRow[];
  gross: number;
  net: number;
  cost: number;
  value: number;
  yieldOnCost: number | null;
  yieldOnValue: number | null;
  withholding: number;
} {
  const out: IncomeRow[] = rows.map((r) => {
    const sorted = [...r.payouts].sort((a, b) => a.exDate.localeCompare(b.exDate));
    const newest = sorted.at(-1) ?? null;
    const stated = newest ? annualizedPayment(newest.amount, newest.frequency) : null;
    const ttm = trailingDividends(sorted, asOf);
    const perShare = stated ?? (ttm.perShare > 0 ? ttm.perShare : 0);
    const basis: IncomeRow['basis'] =
      stated !== null ? 'stated-frequency' : ttm.perShare > 0 ? 'trailing-12m' : 'none';
    const gross = perShare * r.shares;
    return {
      ticker: r.ticker,
      shares: r.shares,
      perShare,
      basis,
      from: basis === 'stated-frequency' ? newest : basis === 'trailing-12m' ? ttm.latest : null,
      gross,
      net: gross * (1 - withholding),
      yieldOnCost: r.costBasis > 0 ? perShare / r.costBasis : null,
      yieldOnPrice: r.price > 0 ? perShare / r.price : null,
    };
  });
  out.sort((a, b) => b.gross - a.gross || a.ticker.localeCompare(b.ticker));
  const gross = out.reduce((a, r) => a + r.gross, 0);
  const cost = rows.reduce((a, r) => a + r.costBasis * r.shares, 0);
  const value = rows.reduce((a, r) => a + r.price * r.shares, 0);
  return {
    rows: out,
    gross,
    net: gross * (1 - withholding),
    cost,
    value,
    yieldOnCost: cost > 0 ? gross / cost : null,
    yieldOnValue: value > 0 ? gross / value : null,
    withholding,
  };
}
