/**
 * Khaled's actual result from Journal trades (`portfolio-return-1`, ADR 0048 build plan item 6). Pure.
 *
 * Cash flows. Marsad does not track the Sahm cash balance, so each buy is a deposit (shares times price, plus the
 * fee) and each sell a withdrawal (shares times price, less the fee). A Journal trade is one buy at entry and, once
 * closed, one sell of the same shares at exit; two trades in one ticker are an add, and closing one of them is a
 * partial sell. Short trades are left out (and listed), as is anything after `asOf` (point in time: an exit after
 * it is still open). Fees are optional fields; Journal trades without them count as zero fee.
 *
 * Time-weighted return (TWR). The calendar is SPY's stored sessions from the first flow to `asOf`. Each session is
 * valued at its closes. A session with trades splits at the trade into two linked sub-periods:
 * - from the prior close to the trade: M / V_prev, where M is the holdings carried in, valued with each traded
 *   ticker at its first fill of the day and every other ticker at the close, less the fees on sells;
 * - from the trade to the close: V / (M + D - W), with deposits D (buys plus fees) in and withdrawals W (sells less
 *   fees) out.
 * The day's return is the product minus 1 (a session without trades reduces to V / V_prev - 1). For one ticker
 * this is exactly its price change, whatever the size of a deposit. With several tickers, the untraded ones are
 * taken to have moved before the trade (daily closes cannot place their move within the day). A day with no
 * capital (nothing held and nothing bought) is skipped. A missing close for a holding carries the newest known
 * price (today's fill when the ticker traded, else its last close) and flags the day; when more than 5% of the
 * sessions are flagged, the TWR is null with the reason. The TWR is annualized only over at least 365 days.
 *
 * Money-weighted return. XIRR of the investor's flows (buys negative, sells positive, the end value positive on the
 * last session), annual, on an actual/365 day count (as spreadsheets compute XIRR). Newton's method first; when it
 * fails, bisection on a bracketed root; null when neither converges.
 *
 * SPY with the same cash flows. Each deposit buys SPY at that session's close for the same dollars; each withdrawal
 * sells the same dollars of SPY. SPY's TWR is its close-to-close change over the days the book held capital. A
 * withdrawal larger than the SPY balance is allowed and flagged (`negativeBalance`).
 *
 * Not included: dividends received (the Journal does not record them) and SPY's dividends (stored closes are price
 * only). Returns are fractions (0.12 is +12%). These are returns, not case-count statistics, so the 30-case rule
 * does not apply; `trades` and `closedTrades` are returned for display.
 */
import type { DailyBar } from './study.js';
import { daysBetween } from './trader.js';

export const PORTFOLIO_RETURN_VERSION = 'portfolio-return-1';

/** Above this share of sessions with a carried close, the TWR is null. */
export const MAX_MISSING_SHARE = 0.05;

/** What the figures leave out, shown beside them. */
export const PORTFOLIO_RETURN_METHOD = Object.freeze([
  'Buys count as deposits and sells as withdrawals, at the trade price; Sahm cash is not tracked.',
  'Dividends received are not in the Journal and are not included.',
  'SPY uses stored closes, price only, bought and sold at the close of each trade date.',
]);

/** A trade as this formula reads it; a `JournalTrade` fits it as is. */
export interface PortfolioTrade {
  id: number;
  ticker: string;
  side: 'long' | 'short';
  entryDate: string;
  entryPrice: number;
  shares: number;
  exitDate: string | null;
  exitPrice: number | null;
  /** Commission on the buy and the sell in USD, when stored. */
  entryFee?: number | null;
  exitFee?: number | null;
}

export interface TradeFlow {
  tradeId: number;
  ticker: string;
  /** The trade date as recorded. */
  date: string;
  side: 'buy' | 'sell';
  shares: number;
  price: number;
  fee: number;
}

/** A dated cash flow from the investor's side: negative is money put in, positive is money taken out. */
export interface CashFlow {
  date: string;
  amount: number;
}

export interface ExcludedTrade {
  tradeId: number;
  ticker: string;
  reason: string;
}

const fee = (v: number | null | undefined) => (typeof v === 'number' && v > 0 ? v : 0);

/** Buys and sells from trades, as of `asOf` (inclusive), in date order (buys before sells on the same date). */
export function tradeFlows(
  trades: readonly PortfolioTrade[],
  asOf: string,
): { flows: TradeFlow[]; excluded: ExcludedTrade[]; trades: number; closedTrades: number } {
  const flows: TradeFlow[] = [];
  const excluded: ExcludedTrade[] = [];
  let included = 0;
  let closed = 0;
  for (const t of trades) {
    const out = (reason: string) => excluded.push({ tradeId: t.id, ticker: t.ticker, reason });
    if (t.entryDate > asOf) continue; // not yet placed as of the date: not part of the period at all
    if (t.side !== 'long') {
      out('short trades are not included');
      continue;
    }
    if (!(t.entryPrice > 0) || !(t.shares > 0)) {
      out('entry price or shares not above zero');
      continue;
    }
    const exited = t.exitDate !== null && t.exitDate <= asOf;
    if (exited && !(t.exitPrice !== null && t.exitPrice > 0)) {
      out('exit date without a positive exit price');
      continue;
    }
    if (exited && (t.exitDate as string) < t.entryDate) {
      out('exit date before the entry date');
      continue;
    }
    included += 1;
    flows.push({
      tradeId: t.id,
      ticker: t.ticker,
      date: t.entryDate,
      side: 'buy',
      shares: t.shares,
      price: t.entryPrice,
      fee: fee(t.entryFee),
    });
    if (exited) {
      closed += 1;
      flows.push({
        tradeId: t.id,
        ticker: t.ticker,
        date: t.exitDate as string,
        side: 'sell',
        shares: t.shares,
        price: t.exitPrice as number,
        fee: fee(t.exitFee),
      });
    }
  }
  flows.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.side === b.side ? a.tradeId - b.tradeId : a.side === 'buy' ? -1 : 1),
  );
  return { flows, excluded, trades: included, closedTrades: closed };
}

export interface XirrResult {
  /** Annual rate as a fraction. */
  rate: number;
  method: 'newton' | 'bisection';
  iterations: number;
}

/**
 * XIRR: the annual rate r where the sum of amount / (1 + r)^(days from the first flow / 365) is zero. Null without
 * both a negative and a positive flow, or when neither Newton's method nor bisection converges.
 */
export function xirr(
  flows: readonly CashFlow[],
  opts: { guess?: number; newtonIterations?: number } = {},
): XirrResult | null {
  const fs = flows.filter((f) => Number.isFinite(f.amount) && f.amount !== 0);
  if (!fs.some((f) => f.amount < 0) || !fs.some((f) => f.amount > 0)) return null;
  const d0 = fs.reduce((m, f) => (f.date < m ? f.date : m), (fs[0] as CashFlow).date);
  const ts = fs.map((f) => daysBetween(d0, f.date) / 365);
  if (ts.every((t) => t === 0)) return null;
  const scale = fs.reduce((s, f) => s + Math.abs(f.amount), 0);
  const npv = (r: number) =>
    fs.reduce((s, f, i) => s + f.amount * (1 + r) ** -(ts[i] as number), 0);
  const dnpv = (r: number) =>
    fs.reduce((s, f, i) => {
      const t = ts[i] as number;
      return s - t * f.amount * (1 + r) ** (-t - 1);
    }, 0);
  const tol = 1e-12 * scale;

  let r = opts.guess ?? 0.1;
  for (let i = 1; i <= (opts.newtonIterations ?? 100); i += 1) {
    const v = npv(r);
    const d = dnpv(r);
    if (!Number.isFinite(v) || !Number.isFinite(d) || d === 0) break;
    const next = r - v / d;
    if (!Number.isFinite(next) || next <= -1) break;
    if (Math.abs(next - r) < 1e-12 || Math.abs(npv(next)) < tol)
      return { rate: next, method: 'newton', iterations: i };
    r = next;
  }

  // Bisection: bracket a sign change between just above -100% and a rate that doubles up to 1e6 (100,000,000%).
  let lo = -0.999999;
  let hi = 1;
  let flo = npv(lo);
  let fhi = npv(hi);
  while (Number.isFinite(fhi) && Math.sign(flo) === Math.sign(fhi) && hi < 1e6) {
    hi *= 2;
    fhi = npv(hi);
  }
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || Math.sign(flo) === Math.sign(fhi))
    return null;
  for (let i = 1; i <= 300; i += 1) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (Math.abs(fm) < tol || hi - lo < 1e-13)
      return { rate: mid, method: 'bisection', iterations: i };
    if (Math.sign(fm) === Math.sign(flo)) {
      lo = mid;
      flo = fm;
    } else hi = mid;
  }
  return null;
}

/** Why `xirr` returned null for these flows. */
function xirrWhy(flows: readonly CashFlow[]): string {
  if (new Set(flows.map((f) => f.date)).size < 2) return 'all cash flows fall on one day';
  if (!flows.some((f) => f.amount < 0) || !flows.some((f) => f.amount > 0))
    return 'the cash flows do not change sign';
  return 'the money-weighted rate did not converge';
}

export interface PortfolioDay {
  date: string;
  /** Holdings at the close, after the day's trades. */
  value: number;
  deposits: number;
  withdrawals: number;
  /** The day's linked return; null on a day with no capital. */
  return: number | null;
  /** Holdings valued at a carried close on this day. */
  carried: string[];
}

export interface PortfolioReturnInput {
  trades: readonly PortfolioTrade[];
  /** Ascending stored daily bars by ticker (split-adjusted is not required: trades are in as-traded prices). */
  closes: Readonly<Record<string, readonly DailyBar[]>>;
  /** SPY's ascending stored bars; also the session calendar. */
  spy: readonly DailyBar[];
  /** The last session counted (inclusive); defaults to SPY's newest bar. */
  asOf?: string;
}

export interface PortfolioReturn {
  formulaVersion: string;
  method: readonly string[];
  period: { from: string; to: string; sessions: number; calendarDays: number } | null;
  trades: number;
  closedTrades: number;
  excluded: ExcludedTrade[];
  /** Buys plus sells counted. */
  cashFlows: number;
  /** Flows dated off SPY's sessions (a weekend or a holiday), counted on the next session. */
  flowsOffSession: number;
  deposits: number;
  withdrawals: number;
  fees: number;
  endValue: number | null;
  /** Sessions with at least one holding valued at a carried close, and each carried close. */
  missingDays: number;
  missingCloses: { ticker: string; date: string }[];
  twr: number | null;
  twrAnnualized: number | null;
  twrUnavailable: string | null;
  moneyWeighted: number | null;
  moneyWeightedMethod: XirrResult['method'] | null;
  moneyWeightedUnavailable: string | null;
  spy: {
    endValue: number;
    twr: number;
    moneyWeighted: number | null;
    negativeBalance: boolean;
  } | null;
  days: PortfolioDay[];
}

/** The book's time-weighted and money-weighted result from trades, beside SPY with the same cash flows. */
export function portfolioReturn(x: PortfolioReturnInput): PortfolioReturn {
  const asOf = x.asOf ?? x.spy.at(-1)?.date ?? '';
  const { flows, excluded, trades, closedTrades } = tradeFlows(x.trades, asOf);
  const base: PortfolioReturn = {
    formulaVersion: PORTFOLIO_RETURN_VERSION,
    method: PORTFOLIO_RETURN_METHOD,
    period: null,
    trades,
    closedTrades,
    excluded,
    cashFlows: flows.length,
    flowsOffSession: 0,
    deposits: 0,
    withdrawals: 0,
    fees: 0,
    endValue: null,
    missingDays: 0,
    missingCloses: [],
    twr: null,
    twrAnnualized: null,
    twrUnavailable: null,
    moneyWeighted: null,
    moneyWeightedMethod: null,
    moneyWeightedUnavailable: null,
    spy: null,
    days: [],
  };
  if (flows.length === 0) {
    const why = 'no long trades in the period';
    return { ...base, twrUnavailable: why, moneyWeightedUnavailable: why };
  }
  const first = (flows[0] as TradeFlow).date;
  const sessions = x.spy.filter((b) => b.date >= first && b.date <= asOf);
  if (sessions.length === 0) {
    const why = `no SPY sessions stored from ${first} to ${asOf}`;
    return { ...base, twrUnavailable: why, moneyWeightedUnavailable: why };
  }

  // Each flow on its session: the first stored session on or after the trade date.
  const bySession = new Map<string, TradeFlow[]>();
  let off = 0;
  let k = 0;
  for (const f of flows) {
    while (k < sessions.length && (sessions[k] as DailyBar).date < f.date) k += 1;
    const s = sessions[k];
    if (!s) continue; // cannot happen: flows are on or before asOf and the last session is asOf or earlier
    if (s.date !== f.date) off += 1;
    const list = bySession.get(s.date) ?? [];
    list.push(f);
    bySession.set(s.date, list);
  }

  const closeOf = new Map<string, Map<string, number>>();
  for (const [t, bars] of Object.entries(x.closes))
    closeOf.set(t, new Map(bars.filter((b) => b.close > 0).map((b) => [b.date, b.close])));
  const known = new Map<string, number>(); // the last known close (or fill) by ticker
  const held = new Map<string, number>();

  const days: PortfolioDay[] = [];
  const missingCloses: { ticker: string; date: string }[] = [];
  const investorFlows: CashFlow[] = [];
  let prevValue = 0;
  let link = 1;
  let spyLink = 1;
  let spyShares = 0;
  let spyNegative = false;
  let prevSpyClose: number | null = null;
  let deposits = 0;
  let withdrawals = 0;
  let fees = 0;

  for (const s of sessions) {
    const today = bySession.get(s.date) ?? [];
    const before = new Map([...held.entries()].filter(([, n]) => n > 1e-12));
    // Prices at the trade: each traded ticker's first fill of the day.
    const fill = new Map<string, number>();
    for (const f of today) if (!fill.has(f.ticker)) fill.set(f.ticker, f.price);
    const tickers = [...new Set([...before.keys(), ...fill.keys()])].sort();
    const close = new Map<string, number>();
    for (const t of tickers) {
      const c = closeOf.get(t)?.get(s.date);
      if (c !== undefined) close.set(t, c);
    }
    let D = 0;
    let W = 0;
    let sellFees = 0;
    for (const f of today) {
      const n = held.get(f.ticker) ?? 0;
      if (f.side === 'buy') {
        const cash = f.shares * f.price + f.fee;
        D += cash;
        held.set(f.ticker, n + f.shares);
        investorFlows.push({ date: s.date, amount: -cash });
      } else {
        const cash = f.shares * f.price - f.fee;
        W += cash;
        sellFees += f.fee;
        held.set(f.ticker, n - f.shares);
        investorFlows.push({ date: s.date, amount: cash });
      }
      fees += f.fee;
    }
    // A missing close carries the newest known price: today's fill when the ticker traded, else the last close.
    const priceOf = (t: string) => close.get(t) ?? fill.get(t) ?? known.get(t) ?? 0;
    // Sub-period 1, the prior close to the trade: the holdings carried in, traded tickers at the fill and the
    // others at the close, less the fees on sells.
    let mid = -sellFees;
    for (const [t, n] of before) mid += n * (fill.get(t) ?? priceOf(t));
    // Sub-period 2, the trade to the close: the holdings after the trades, at the close.
    const carried: string[] = [];
    let value = 0;
    for (const t of tickers) {
      const n = held.get(t) ?? 0;
      if (n > 1e-12) {
        if (!close.has(t)) {
          carried.push(t);
          missingCloses.push({ ticker: t, date: s.date });
        }
        value += n * priceOf(t);
      }
      known.set(t, priceOf(t));
    }
    const hadCapital = prevValue > 1e-9;
    const f1 = hadCapital ? mid / prevValue : 1;
    const capital2 = (hadCapital ? mid : 0) + D - W;
    const f2 = capital2 > 1e-9 ? value / capital2 : 1;
    const r = hadCapital || capital2 > 1e-9 ? f1 * f2 - 1 : null;
    if (r !== null) link *= 1 + r;
    deposits += D;
    withdrawals += W;

    // SPY with the same dollars at its close.
    if (D > 0 || W > 0) spyShares += (D - W) / s.close;
    if (spyShares < -1e-9) spyNegative = true;
    if (hadCapital && prevSpyClose !== null && prevSpyClose > 0) spyLink *= s.close / prevSpyClose;
    prevSpyClose = s.close;

    days.push({ date: s.date, value, deposits: D, withdrawals: W, return: r, carried });
    prevValue = value;
  }

  const last = sessions.at(-1) as DailyBar;
  const from = (sessions[0] as DailyBar).date;
  const calendarDays = daysBetween(from, last.date);
  const missingDays = days.filter((d) => d.carried.length > 0).length;
  const share = missingDays / sessions.length;
  const endValue = prevValue;

  let twr: number | null = link - 1;
  let twrUnavailable: string | null = null;
  if (share > MAX_MISSING_SHARE) {
    twr = null;
    twrUnavailable = `${missingDays} of ${sessions.length} sessions lack a close for a holding (more than ${MAX_MISSING_SHARE * 100}%)`;
  }
  const twrAnnualized =
    twr !== null && calendarDays >= 365 ? (1 + twr) ** (365 / calendarDays) - 1 : null;

  const mwFlows =
    endValue > 0 ? [...investorFlows, { date: last.date, amount: endValue }] : investorFlows;
  const mw = xirr(mwFlows);
  const spyEnd = spyShares * last.close;
  const spyFlows = [
    ...investorFlows,
    ...(Math.abs(spyEnd) > 1e-9 ? [{ date: last.date, amount: spyEnd }] : []),
  ];
  const spyMw = xirr(spyFlows);

  return {
    ...base,
    period: { from, to: last.date, sessions: sessions.length, calendarDays },
    flowsOffSession: off,
    deposits,
    withdrawals,
    fees,
    endValue,
    missingDays,
    missingCloses,
    twr,
    twrAnnualized,
    twrUnavailable,
    moneyWeighted: mw?.rate ?? null,
    moneyWeightedMethod: mw?.method ?? null,
    moneyWeightedUnavailable: mw === null ? xirrWhy(mwFlows) : null,
    spy: {
      endValue: spyEnd,
      twr: spyLink - 1,
      moneyWeighted: spyMw?.rate ?? null,
      negativeBalance: spyNegative,
    },
    days,
  };
}
