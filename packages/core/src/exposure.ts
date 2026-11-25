/**
 * Exposure, beta and stress (ADR 0022, `exposure-1`): position weights, sector totals, beta-weighted exposure to
 * SPY, concentration, return correlations, and stress scenarios (SPY down 5%, 10% and 20%; VIX up 10 points; a
 * 10% sector shock). Betas and sensitivities are ordinary least-squares slopes of daily simple returns over the
 * last 252 common sessions. Every scenario is a linear approximation and says so, naming what it had to assume.
 * Pure. Known answers come from numpy.
 */
import { SECTOR_ETFS } from './watch.js';
import type { DailyBar } from './study.js';

export const EXPOSURE_VERSION = 'exposure-1';
export const BETA_WINDOW = 252;
/** Fewer common sessions than this and a slope is not reported. */
export const MIN_BETA_OBS = 60;

export interface DatedValue {
  date: string;
  value: number;
}

const toSeries = (bars: readonly DailyBar[]): DatedValue[] =>
  bars.map((b) => ({ date: b.date, value: b.close }));

/** Simple returns (for prices) or differences (for levels such as the VIX), keyed by the later date. */
function changes(s: readonly DatedValue[], kind: 'return' | 'difference'): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1] as DatedValue;
    const b = s[i] as DatedValue;
    out.set(b.date, kind === 'return' ? b.value / a.value - 1 : b.value - a.value);
  }
  return out;
}

/** The two change series on their common dates, newest `window` kept. */
function aligned(
  y: Map<string, number>,
  x: Map<string, number>,
  window: number,
): { y: number[]; x: number[] } {
  const dates = [...y.keys()].filter((d) => x.has(d)).sort();
  const keep = dates.slice(-window);
  return { y: keep.map((d) => y.get(d) as number), x: keep.map((d) => x.get(d) as number) };
}

function moments(y: readonly number[], x: readonly number[]) {
  const n = y.length;
  const my = y.reduce((a, b) => a + b, 0) / n;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (x[i] as number) - mx;
    const dy = (y[i] as number) - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return { n, sxy, sxx, syy };
}

export interface Slope {
  /** Change in y per unit change in x. */
  slope: number;
  correlation: number;
  /** Common sessions used. */
  n: number;
}

function slopeOf(y: readonly number[], x: readonly number[], minObs: number): Slope | null {
  if (y.length < minObs) return null;
  const m = moments(y, x);
  if (m.sxx === 0 || m.syy === 0) return null;
  return { slope: m.sxy / m.sxx, correlation: m.sxy / Math.sqrt(m.sxx * m.syy), n: m.n };
}

/** Beta of an asset to a benchmark from daily simple returns on common sessions. */
export function beta(
  asset: readonly DailyBar[],
  bench: readonly DailyBar[],
  window = BETA_WINDOW,
  minObs = MIN_BETA_OBS,
): Slope | null {
  const a = aligned(changes(toSeries(asset), 'return'), changes(toSeries(bench), 'return'), window);
  return slopeOf(a.y, a.x, minObs);
}

/** Daily return of the asset per one-point daily change in the VIX (usually negative). */
export function vixSensitivity(
  asset: readonly DailyBar[],
  vix: readonly DatedValue[],
  window = BETA_WINDOW,
  minObs = MIN_BETA_OBS,
): Slope | null {
  const a = aligned(changes(toSeries(asset), 'return'), changes(vix, 'difference'), window);
  return slopeOf(a.y, a.x, minObs);
}

/** Correlation of daily returns for every pair, flagged at 0.8 and above. */
export function correlationPairs(
  series: readonly { ticker: string; bars: readonly DailyBar[] }[],
  window = 126,
  minObs = MIN_BETA_OBS,
): { a: string; b: string; correlation: number; n: number; high: boolean }[] {
  const rets = series.map((s) => ({ ticker: s.ticker, r: changes(toSeries(s.bars), 'return') }));
  const out: { a: string; b: string; correlation: number; n: number; high: boolean }[] = [];
  for (let i = 0; i < rets.length; i++)
    for (let j = i + 1; j < rets.length; j++) {
      const p = rets[i] as (typeof rets)[number];
      const q = rets[j] as (typeof rets)[number];
      const al = aligned(p.r, q.r, window);
      const s = slopeOf(al.y, al.x, minObs);
      if (s)
        out.push({
          a: p.ticker,
          b: q.ticker,
          correlation: s.correlation,
          n: s.n,
          high: s.correlation >= 0.8,
        });
    }
  return out.sort((x, y) => y.correlation - x.correlation);
}

export interface PositionExposure {
  ticker: string;
  shares: number;
  price: number;
  /** Sector ETF the owner assigned (for example XLK), or null. */
  sectorEtf: string | null;
  /** Beta to SPY, or null when there is too little history. */
  beta: number | null;
  /** Daily return per VIX point, or null. */
  vixSensitivity: number | null;
  /** Beta to its sector ETF, or null. */
  sectorBeta: number | null;
}

export interface Scenario {
  name: string;
  /** Estimated change in portfolio value, USD (negative is a loss). */
  usd: number;
  /** As a fraction of the portfolio value. */
  pct: number;
  /** What the estimate had to assume, in plain words. */
  assumptions: string[];
}

export interface ExposureReport {
  version: string;
  totalValue: number;
  positions: (PositionExposure & { value: number; weight: number })[];
  sectors: { sector: string; etf: string | null; value: number; weight: number }[];
  /** Sum of value times beta: the SPY dollars that move like the portfolio. */
  betaDollars: number;
  /** Beta-weighted exposure as a fraction of the portfolio value (the portfolio beta). */
  portfolioBeta: number;
  /** Tickers whose beta was missing and counted as 1. */
  betaAssumed: string[];
  concentration: {
    largest: { ticker: string; weight: number } | null;
    top3Weight: number;
    /** Herfindahl index of the weights (1 is a single position). */
    hhi: number;
    /** 1 / HHI: the number of equal positions with the same concentration. */
    effectivePositions: number;
  };
  scenarios: Scenario[];
}

const sectorName = (etf: string | null) =>
  etf === null
    ? 'Unassigned'
    : (SECTOR_ETFS.find((s) => s.ticker === etf)?.sector ?? `Other (${etf})`);

/** The exposure report for open positions priced at their latest close. */
export function exposureReport(positions: readonly PositionExposure[]): ExposureReport {
  const valued = positions.map((p) => ({ ...p, value: p.shares * p.price }));
  const total = valued.reduce((a, p) => a + p.value, 0);
  const withWeight = valued
    .map((p) => ({ ...p, weight: total > 0 ? p.value / total : 0 }))
    .sort((a, b) => b.value - a.value);
  const bySector = new Map<string, { etf: string | null; value: number }>();
  for (const p of withWeight) {
    const name = sectorName(p.sectorEtf);
    const cur = bySector.get(name) ?? { etf: p.sectorEtf, value: 0 };
    cur.value += p.value;
    bySector.set(name, cur);
  }
  const sectors = [...bySector.entries()]
    .map(([sector, v]) => ({
      sector,
      etf: v.etf,
      value: v.value,
      weight: total > 0 ? v.value / total : 0,
    }))
    .sort((a, b) => b.value - a.value);
  const betaAssumed = withWeight.filter((p) => p.beta === null).map((p) => p.ticker);
  const betaDollars = withWeight.reduce((a, p) => a + p.value * (p.beta ?? 1), 0);
  const hhi = withWeight.reduce((a, p) => a + p.weight * p.weight, 0);
  const pct = (usd: number) => (total > 0 ? usd / total : 0);
  const assumedText =
    betaAssumed.length > 0 ? [`Beta counted as 1 for ${betaAssumed.join(', ')}.`] : [];
  const scenarios: Scenario[] = [-0.05, -0.1, -0.2].map((m) => {
    const usd = betaDollars * m;
    return {
      name: `SPY down ${Math.round(-m * 100)}%`,
      usd,
      pct: pct(usd),
      assumptions: ['Linear in each beta; ignores gaps and changing correlations.', ...assumedText],
    };
  });
  const noVix = withWeight.filter((p) => p.vixSensitivity === null).map((p) => p.ticker);
  const vixUsd = withWeight.reduce((a, p) => a + p.value * (p.vixSensitivity ?? 0) * 10, 0);
  scenarios.push({
    name: 'VIX up 10 points',
    usd: vixUsd,
    pct: pct(vixUsd),
    assumptions: [
      'Linear in the daily return per VIX point; a 10-point jump in one day is rare and moves are larger in the tails.',
      ...(noVix.length > 0 ? [`No VIX sensitivity for ${noVix.join(', ')}: left out.`] : []),
    ],
  });
  for (const s of sectors) {
    if (s.etf === null) continue;
    const members = withWeight.filter((p) => p.sectorEtf === s.etf);
    const assumed = members.filter((p) => p.sectorBeta === null).map((p) => p.ticker);
    const usd = members.reduce((a, p) => a + p.value * (p.sectorBeta ?? 1) * -0.1, 0);
    scenarios.push({
      name: `${s.sector} (${s.etf}) down 10%`,
      usd,
      pct: pct(usd),
      assumptions: [
        'Only holdings assigned to this sector; spillover to other sectors left out.',
        ...(assumed.length > 0 ? [`Beta to ${s.etf} counted as 1 for ${assumed.join(', ')}.`] : []),
      ],
    });
  }
  return {
    version: EXPOSURE_VERSION,
    totalValue: total,
    positions: withWeight,
    sectors,
    betaDollars,
    portfolioBeta: pct(betaDollars),
    betaAssumed,
    concentration: {
      largest: withWeight[0]
        ? { ticker: withWeight[0].ticker, weight: withWeight[0].weight }
        : null,
      top3Weight: withWeight.slice(0, 3).reduce((a, p) => a + p.weight, 0),
      hhi,
      effectivePositions: hhi > 0 ? 1 / hhi : 0,
    },
    scenarios,
  };
}
