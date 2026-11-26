/**
 * Point-in-time backtester (ADR 0017, `backtest-1`), built on the rule evaluator: a signal on a completed bar enters
 * at the next bar's open; stops are checked inside each bar (a gap through the stop fills at the open); exit and time
 * stops leave at the next open. Costs per side in basis points. Reports carry bootstrap 90% intervals, a benchmark,
 * a regime breakdown and Monte Carlo drawdowns; walk-forward folds and an untouched holdout guard against
 * overfitting. Pure and seeded.
 */
import { RuleEvaluator, type RuleDoc } from './rules.js';
import {
  MIN_CASES,
  bootstrap,
  deflatedSharpe,
  maxDrawdown,
  mean,
  mulberry32,
  quantileSorted,
  sharpe,
  tradeStats,
  type Interval,
  type TradeStats,
} from './stats.js';
import type { DailyBar } from './study.js';

export const BACKTEST_VERSION = 'backtest-1';

export interface Costs {
  /** Commission per side, basis points of the traded value. */
  commissionBps: number;
  /** Slippage per side (about half the spread for liquid stocks), basis points. */
  slippageBps: number;
  /** Currency conversion per side, basis points (USD bought with SAR and sold back). */
  fxBps: number;
}

export const DEFAULT_COSTS: Costs = { commissionBps: 5, slippageBps: 5, fxBps: 0 };

export type ExitReason = 'exit' | 'stop' | 'time' | 'end';

export interface Trade {
  ticker: string;
  signalDate: string;
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  reason: ExitReason;
  bars: number;
  /** Net return after costs on both sides. */
  ret: number;
  /** True when the data ended with the trade open (closed at the last close for the report). */
  open: boolean;
}

/** Runs one rule over one ticker's bars (oldest first, split-adjusted). */
export function backtest(
  rule: RuleDoc,
  bars: readonly DailyBar[],
  ticker: string,
  costs: Costs = DEFAULT_COSTS,
): Trade[] {
  const ev = new RuleEvaluator(bars);
  const side = (costs.commissionBps + costs.slippageBps + costs.fxBps) / 10_000;
  const trades: Trade[] = [];
  let i = 0;
  while (i < bars.length - 1) {
    if (ev.holds(rule.entry, i) !== true) {
      i += 1;
      continue;
    }
    const e = i + 1; // enter at the next open
    const entryBar = bars[e] as DailyBar;
    const entryPrice = entryBar.open;
    let stopPrice: number | null = null;
    if (rule.stop && 'pct' in rule.stop) stopPrice = entryPrice * (1 - rule.stop.pct);
    else if (rule.stop && 'atr' in rule.stop) {
      const a = ev.value({ ind: 'atr', period: 14 }, i);
      stopPrice = a === null ? null : entryPrice - rule.stop.atr * a;
    }
    let exitIdx = -1;
    let exitPrice = 0;
    let reason: ExitReason = 'end';
    for (let j = e; j < bars.length; j++) {
      const b = bars[j] as DailyBar;
      if (stopPrice !== null && b.low <= stopPrice) {
        exitIdx = j;
        exitPrice = Math.min(b.open, stopPrice);
        reason = 'stop';
        break;
      }
      const held = j - e + 1;
      const wantsExit = rule.exit ? ev.holds(rule.exit, j) === true : false;
      const timeUp = rule.maxHoldBars !== undefined && held >= rule.maxHoldBars;
      if ((wantsExit || timeUp) && j + 1 < bars.length) {
        exitIdx = j + 1;
        exitPrice = (bars[j + 1] as DailyBar).open;
        reason = wantsExit ? 'exit' : 'time';
        break;
      }
    }
    const open = exitIdx < 0;
    if (open) {
      exitIdx = bars.length - 1;
      exitPrice = (bars[exitIdx] as DailyBar).close;
    }
    const gross = exitPrice / entryPrice;
    trades.push({
      ticker,
      signalDate: (bars[i] as DailyBar).date,
      entryDate: entryBar.date,
      entryPrice,
      exitDate: (bars[exitIdx] as DailyBar).date,
      exitPrice,
      reason,
      bars: exitIdx - e + 1,
      ret: (gross * (1 - side)) / (1 + side) - 1,
      open,
    });
    // The next signal can come on the exit bar's close at the earliest (no overlapping positions).
    i = Math.max(exitIdx, i + 1);
  }
  return trades;
}

export interface StatWithInterval {
  value: number | null;
  ci90: Interval | null;
}

export interface BacktestReport {
  version: string;
  stats: TradeStats;
  expectancy: StatWithInterval;
  winRate: StatWithInterval;
  /** Buy-and-hold return of the benchmark over the same dates, when given. */
  benchmark: { ticker: string; ret: number } | null;
  /** Per regime label at the signal date; values only from 30 trades. */
  byRegime: { label: string; n: number; expectancy: number | null; sufficient: boolean }[];
  /** Max drawdown across shuffled trade orders: median and the worst 5%. */
  monteCarlo: { median: number; worst5: number; runs: number } | null;
  /** Growth of 1 over the closed trades in exit order (see `equityCurve`). Absent in reports stored before it. */
  equity?: EquityPoint[];
}

export interface EquityPoint {
  /** The exit date of the trade that produced this value. */
  date: string;
  /** Growth of 1 after this trade, rounded to 6 decimals. */
  equity: number;
}

/**
 * Growth of 1 over closed trades taken one after another in exit-date order (ties by ticker), each at full size,
 * the same convention as `maxDrawdown` and the Monte Carlo drawdowns. It is a sequence of trades, not a portfolio:
 * trades that overlapped in time are not split. Long reports are thinned to about `maxPoints` evenly spaced
 * points, always keeping the lowest, the highest and the last, so the deepest fall stays visible.
 */
export function equityCurve(trades: readonly Trade[], maxPoints = 200): EquityPoint[] {
  const closed = trades
    .filter((t) => !t.open)
    .sort((a, b) => a.exitDate.localeCompare(b.exitDate) || a.ticker.localeCompare(b.ticker));
  let e = 1;
  const all = closed.map((t) => {
    e *= 1 + t.ret;
    return { date: t.exitDate, equity: Math.round(e * 1e6) / 1e6 };
  });
  if (all.length <= maxPoints) return all;
  const keep = new Set<number>();
  const step = (all.length - 1) / (maxPoints - 1);
  for (let k = 0; k < maxPoints; k++) keep.add(Math.round(k * step));
  let lo = 0;
  let hi = 0;
  all.forEach((p, i) => {
    if (p.equity < (all[lo] as EquityPoint).equity) lo = i;
    if (p.equity > (all[hi] as EquityPoint).equity) hi = i;
  });
  keep
    .add(lo)
    .add(hi)
    .add(all.length - 1);
  return [...keep].sort((a, b) => a - b).map((i) => all[i] as EquityPoint);
}

/** Report on closed trades (open ones are left out), with seeded intervals and simulations. */
export function backtestReport(
  trades: readonly Trade[],
  opts: {
    seed?: number;
    benchmark?: { ticker: string; bars: readonly DailyBar[] };
    regimeAt?: (date: string) => string | null;
    monteCarloRuns?: number;
  } = {},
): BacktestReport {
  const closed = trades.filter((t) => !t.open);
  const rets = closed.map((t) => t.ret);
  const stats = tradeStats(rets);
  const seed = opts.seed ?? 1;
  const enough = rets.length >= MIN_CASES;
  const winRateOf = (xs: readonly number[]) => xs.filter((x) => x > 0).length / xs.length;
  let benchmark: BacktestReport['benchmark'] = null;
  if (opts.benchmark && closed.length > 0) {
    const first = closed[0] as Trade;
    const last = closed.reduce((m, t) => (t.exitDate > m.exitDate ? t : m), first);
    const b = opts.benchmark.bars;
    const start = b.find((x) => x.date >= first.entryDate);
    const end = [...b].reverse().find((x) => x.date <= last.exitDate);
    if (start && end)
      benchmark = { ticker: opts.benchmark.ticker, ret: end.close / start.open - 1 };
  }
  const groups = new Map<string, number[]>();
  if (opts.regimeAt)
    for (const t of closed) {
      const label = opts.regimeAt(t.signalDate) ?? 'unknown';
      groups.set(label, [...(groups.get(label) ?? []), t.ret]);
    }
  let monteCarlo: BacktestReport['monteCarlo'] = null;
  const runs = opts.monteCarloRuns ?? 1000;
  if (rets.length >= 2) {
    const rand = mulberry32(seed + 1);
    const dds: number[] = [];
    const draw = new Array<number>(rets.length);
    for (let r = 0; r < runs; r++) {
      for (let k = 0; k < rets.length; k++)
        draw[k] = rets[Math.floor(rand() * rets.length)] as number;
      dds.push(maxDrawdown(draw));
    }
    dds.sort((a, b) => a - b);
    monteCarlo = { median: quantileSorted(dds, 0.5), worst5: quantileSorted(dds, 0.05), runs };
  }
  return {
    version: BACKTEST_VERSION,
    stats,
    expectancy: { value: stats.expectancy, ci90: enough ? bootstrap(rets, mean, { seed }) : null },
    winRate: { value: stats.winRate, ci90: enough ? bootstrap(rets, winRateOf, { seed }) : null },
    benchmark,
    equity: equityCurve(closed),
    byRegime: [...groups.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, xs]) => ({
        label,
        n: xs.length,
        expectancy: xs.length >= MIN_CASES ? mean(xs) : null,
        sufficient: xs.length >= MIN_CASES,
      })),
    monteCarlo,
  };
}

export interface WalkForwardSplit {
  /** Walk-forward folds: train on `train`, test on the following `test` window (dates inclusive). */
  folds: { train: [string, string]; test: [string, string] }[];
  /** The final period, never used for choosing; revealed only on request. */
  holdout: [string, string];
}

/**
 * Splits sorted dates into walk-forward folds and a final holdout (default 20%). Each fold trains on everything
 * before its test window (anchored), so no test window ever sees later data.
 */
export function walkForwardSplit(
  dates: readonly string[],
  folds = 4,
  holdoutFraction = 0.2,
): WalkForwardSplit {
  const n = dates.length;
  if (n < (folds + 1) * 10) throw new RangeError('too few dates for the folds');
  const h = Math.floor(n * (1 - holdoutFraction));
  const step = Math.floor(h / (folds + 1));
  const out: WalkForwardSplit['folds'] = [];
  for (let k = 1; k <= folds; k++) {
    const testStart = k * step;
    const testEnd = k === folds ? h - 1 : (k + 1) * step - 1;
    out.push({
      train: [dates[0] as string, dates[testStart - 1] as string],
      test: [dates[testStart] as string, dates[testEnd] as string],
    });
  }
  return { folds: out, holdout: [dates[h] as string, dates[n - 1] as string] };
}

export interface VariantResult {
  rule: RuleDoc;
  /** Per-trade Sharpe on the training data. */
  trainSharpe: number | null;
  testTrades: Trade[];
}

/**
 * Walk-forward evaluation of parameter variants: in each fold the variant with the best training Sharpe is chosen,
 * and only its test-window trades count. Every variant counts as a trial for the deflated Sharpe ratio; the holdout
 * is not touched unless `revealHoldout` is true.
 */
export function walkForward(
  variants: readonly RuleDoc[],
  bars: readonly DailyBar[],
  ticker: string,
  split: WalkForwardSplit,
  opts: { costs?: Costs; revealHoldout?: boolean } = {},
): {
  trials: number;
  chosen: { fold: number; ruleId: string; trainSharpe: number | null }[];
  outOfSample: Trade[];
  deflated: { sharpe: number; expectedMax: number; probability: number } | null;
  holdout: Trade[] | null;
} {
  const costs = opts.costs ?? DEFAULT_COSTS;
  const within = (t: Trade, [a, b]: [string, string]) => t.signalDate >= a && t.exitDate <= b;
  const all = variants.map((v) => ({ rule: v, trades: backtest(v, bars, ticker, costs) }));
  const chosen: { fold: number; ruleId: string; trainSharpe: number | null }[] = [];
  const oos: Trade[] = [];
  const trainSharpes: number[] = [];
  split.folds.forEach((f, k) => {
    let best: { rule: RuleDoc; trades: Trade[]; s: number } | null = null;
    for (const v of all) {
      const train = v.trades.filter((t) => !t.open && within(t, f.train)).map((t) => t.ret);
      const s = train.length >= 2 ? sharpe(train) : NaN;
      if (!Number.isNaN(s)) trainSharpes.push(s);
      if (!Number.isNaN(s) && (best === null || s > best.s)) best = { ...v, s };
    }
    if (best) {
      const b: { rule: RuleDoc; trades: Trade[]; s: number } = best;
      chosen.push({ fold: k, ruleId: b.rule.id, trainSharpe: b.s });
      oos.push(...b.trades.filter((t) => !t.open && within(t, f.test)));
    } else chosen.push({ fold: k, ruleId: '', trainSharpe: null });
  });
  const oosRets = oos.map((t) => t.ret);
  const mu = mean(trainSharpes);
  const variance =
    trainSharpes.length > 1
      ? trainSharpes.reduce((s, x) => s + (x - mu) ** 2, 0) / (trainSharpes.length - 1)
      : 0;
  return {
    trials: variants.length,
    chosen,
    outOfSample: oos,
    deflated: oosRets.length >= 3 ? deflatedSharpe(oosRets, variants.length, variance) : null,
    // The holdout uses the variant chosen in the last fold, as it would be used live.
    holdout: opts.revealHoldout
      ? (all.find((v) => v.rule.id === chosen.at(-1)?.ruleId)?.trades ?? []).filter(
          (t) => !t.open && within(t, split.holdout),
        )
      : null,
  };
}
