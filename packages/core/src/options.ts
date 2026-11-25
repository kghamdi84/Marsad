/**
 * Options math (ADR 0021, `options-1`): Black-Scholes-Merton prices and greeks with a dividend yield, an implied
 * volatility solver, expected move, IV rank and percentile, payoffs of defined-risk structures with breakevens and
 * maximum loss and gain, and the liquidity guard. Known answers come from scipy. Pure; no data needed until an
 * options plan is chosen.
 */
import { normCdf } from './stats.js';
import { toFixedHalfUp } from './ai/template.js';

export const OPTIONS_VERSION = 'options-1';

export type OptionType = 'call' | 'put';

export interface BsInput {
  /** Spot price. */
  s: number;
  /** Strike. */
  k: number;
  /** Years to expiry. */
  t: number;
  /** Risk-free rate, continuous. */
  r: number;
  /** Dividend yield, continuous. */
  q: number;
  /** Volatility (0.25 is 25%). */
  sigma: number;
  type: OptionType;
}

const pdf = (x: number) => Math.exp(-(x * x) / 2) / Math.sqrt(2 * Math.PI);

function d1d2(x: BsInput): [number, number] {
  const v = x.sigma * Math.sqrt(x.t);
  const d1 = (Math.log(x.s / x.k) + (x.r - x.q + (x.sigma * x.sigma) / 2) * x.t) / v;
  return [d1, d1 - v];
}

/** Black-Scholes-Merton price. */
export function bsPrice(x: BsInput): number {
  const [d1, d2] = d1d2(x);
  const df = Math.exp(-x.r * x.t);
  const qf = Math.exp(-x.q * x.t);
  return x.type === 'call'
    ? x.s * qf * normCdf(d1) - x.k * df * normCdf(d2)
    : x.k * df * normCdf(-d2) - x.s * qf * normCdf(-d1);
}

export interface Greeks {
  delta: number;
  gamma: number;
  /** Per 1.00 change in volatility (divide by 100 for one volatility point). */
  vega: number;
  /** Per year (divide by 365 for one calendar day). */
  theta: number;
  /** Per 1.00 change in the rate. */
  rho: number;
}

export function bsGreeks(x: BsInput): Greeks {
  const [d1, d2] = d1d2(x);
  const df = Math.exp(-x.r * x.t);
  const qf = Math.exp(-x.q * x.t);
  const sq = Math.sqrt(x.t);
  const gamma = (qf * pdf(d1)) / (x.s * x.sigma * sq);
  const vega = x.s * qf * pdf(d1) * sq;
  if (x.type === 'call')
    return {
      delta: qf * normCdf(d1),
      gamma,
      vega,
      theta:
        (-x.s * qf * pdf(d1) * x.sigma) / (2 * sq) -
        x.r * x.k * df * normCdf(d2) +
        x.q * x.s * qf * normCdf(d1),
      rho: x.k * x.t * df * normCdf(d2),
    };
  return {
    delta: -qf * normCdf(-d1),
    gamma,
    vega,
    theta:
      (-x.s * qf * pdf(d1) * x.sigma) / (2 * sq) +
      x.r * x.k * df * normCdf(-d2) -
      x.q * x.s * qf * normCdf(-d1),
    rho: -x.k * x.t * df * normCdf(-d2),
  };
}

/**
 * Implied volatility from a price: Newton steps on vega, falling back to bisection, within 1e-10 in price.
 * Null when the price is outside the no-arbitrage bounds.
 */
export function impliedVol(price: number, x: Omit<BsInput, 'sigma'>): number | null {
  const df = Math.exp(-x.r * x.t);
  const qf = Math.exp(-x.q * x.t);
  const lower =
    x.type === 'call' ? Math.max(0, x.s * qf - x.k * df) : Math.max(0, x.k * df - x.s * qf);
  const upper = x.type === 'call' ? x.s * qf : x.k * df;
  if (!(price > lower && price < upper)) return null;
  let lo = 1e-6;
  let hi = 5;
  let sigma = 0.3;
  for (let i = 0; i < 100; i++) {
    const p = bsPrice({ ...x, sigma });
    const diff = p - price;
    if (Math.abs(diff) < 1e-10) return sigma;
    if (diff > 0) hi = sigma;
    else lo = sigma;
    const vega = bsGreeks({ ...x, sigma }).vega;
    let next = vega > 1e-8 ? sigma - diff / vega : NaN;
    if (!(next > lo && next < hi)) next = (lo + hi) / 2;
    sigma = next;
  }
  return sigma;
}

/** Expected move to expiry from the at-the-money straddle mid price: dollars and a fraction of spot. */
export function expectedMove(straddleMid: number, spot: number): { usd: number; pct: number } {
  return { usd: straddleMid, pct: straddleMid / spot };
}

/** IV rank: where today's IV sits between the period's low and high (0 to 100); null without a range. */
export function ivRank(history: readonly number[], current: number): number | null {
  if (history.length === 0) return null;
  const lo = Math.min(...history);
  const hi = Math.max(...history);
  return hi === lo ? null : (100 * (current - lo)) / (hi - lo);
}

/** IV percentile: the share of the period's days with IV below today's (0 to 100). */
export function ivPercentile(history: readonly number[], current: number): number | null {
  if (history.length === 0) return null;
  return (100 * history.filter((v) => v < current).length) / history.length;
}

export interface Leg {
  type: OptionType | 'stock';
  /** Strike (ignored for stock). */
  strike: number;
  /** Positive long, negative short; contracts for options (100 shares each), shares for stock. */
  qty: number;
  /** Premium per share paid (long) or received (short); for stock, the price paid. */
  price: number;
}

/** Profit at expiry for an underlying price, in dollars. */
export function payoffAt(legs: readonly Leg[], at: number): number {
  return legs.reduce((sum, l) => {
    if (l.type === 'stock') return sum + l.qty * (at - l.price);
    const intrinsic = l.type === 'call' ? Math.max(0, at - l.strike) : Math.max(0, l.strike - at);
    return sum + l.qty * 100 * (intrinsic - l.price);
  }, 0);
}

export interface PayoffSummary {
  /** Most that can be lost (a negative number), or null when unlimited. */
  maxLoss: number | null;
  /** Most that can be made, or null when unlimited. */
  maxGain: number | null;
  breakevens: number[];
  /** Max loss is finite: the brief allows only defined-risk structures. */
  definedRisk: boolean;
}

/**
 * Exact for piecewise-linear payoffs: checks every strike, zero, and the slope beyond the highest strike, and finds
 * breakevens by solving each linear piece.
 */
export function payoffSummary(legs: readonly Leg[]): PayoffSummary {
  const strikes = [...new Set(legs.filter((l) => l.type !== 'stock').map((l) => l.strike))].sort(
    (a, b) => a - b,
  );
  const top = (strikes.at(-1) ?? Math.max(1, ...legs.map((l) => l.price))) * 2 + 1;
  const points = [0, ...strikes, top];
  const values = points.map((p) => payoffAt(legs, p));
  const slopeUp = payoffAt(legs, top + 1) - payoffAt(legs, top);
  const finite = values.filter((v) => Number.isFinite(v));
  const lowest = Math.min(...finite);
  const highest = Math.max(...finite);
  const breakevens: number[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i] as number;
    const b = points[i + 1] as number;
    const va = values[i] as number;
    const vb = values[i + 1] as number;
    if (va === 0 && (i === 0 || (values[i - 1] as number) !== 0)) breakevens.push(a);
    else if ((va < 0 && vb > 0) || (va > 0 && vb < 0))
      breakevens.push(a + ((b - a) * -va) / (vb - va));
  }
  const vt = values.at(-1) as number;
  if (slopeUp !== 0 && Math.sign(vt) !== Math.sign(slopeUp) && vt !== 0)
    breakevens.push(top - vt / slopeUp);
  const maxLoss = slopeUp < 0 ? null : Math.min(0, lowest);
  const maxGain = slopeUp > 0 ? null : Math.max(0, highest);
  return {
    maxLoss,
    maxGain,
    breakevens: [...new Set(breakevens.map((x) => Math.round(x * 1e6) / 1e6))],
    definedRisk: maxLoss !== null,
  };
}

/** Liquidity guard: bid-ask spread at most 10% of the mid, and enough open interest. */
export function liquidityOk(
  bid: number,
  ask: number,
  openInterest: number,
  minOpenInterest = 100,
): { ok: boolean; reason: string } {
  const mid = (bid + ask) / 2;
  if (!(bid > 0 && ask >= bid)) return { ok: false, reason: 'no two-sided quote' };
  if ((ask - bid) / mid > 0.1)
    return {
      ok: false,
      reason: `spread ${toFixedHalfUp((100 * (ask - bid)) / mid, 1)}% of the mid, above 10%`,
    };
  if (openInterest < minOpenInterest)
    return { ok: false, reason: `open interest ${openInterest}, below ${minOpenInterest}` };
  return { ok: true, reason: 'spread within 10% of the mid and enough open interest' };
}
