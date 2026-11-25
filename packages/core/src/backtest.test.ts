import { describe, expect, it } from 'vitest';
import known from '../../../fixtures/backtest/sma-cross-known.json';
import { backtest, backtestReport, walkForward, walkForwardSplit, type Costs } from './backtest.js';
import type { RuleDoc } from './rules.js';
import type { DailyBar } from './study.js';

const NO_COSTS: Costs = { commissionBps: 0, slippageBps: 0, fxBps: 0 };

/** Bars from [open, high, low, close] rows; dates d000, d001, ... */
function ohlc(rows: [number, number, number, number][]): DailyBar[] {
  return rows.map(([open, high, low, close], i) => ({
    date: `d${String(i).padStart(3, '0')}`,
    open,
    high,
    low,
    close,
    volume: 1000,
    vwap: null,
  }));
}
const flat = (closes: number[]) => ohlc(closes.map((c) => [c, c, c, c]));

/** The rule without its exit condition (a stop or time stop takes over). */
function noExit(r: RuleDoc, extra: Partial<RuleDoc>): RuleDoc {
  const c: RuleDoc = { ...r, ...extra };
  delete c.exit;
  return c;
}

const breakout: RuleDoc = {
  id: 'breakout-test',
  name: 'Close above 105, leave below 100',
  side: 'long',
  entry: { left: { ind: 'close' }, op: '>', right: 105 },
  exit: { left: { ind: 'close' }, op: '<', right: 100 },
};

describe('backtest (hand-checked)', () => {
  // d002 closes 106 (signal), enter d003 at its open 107; d005 closes 99 (exit signal), leave d006 at its open 98.
  // Next signal d008 (106), enter d009 at 110; the data ends with that trade open.
  const bars = flat([100, 101, 106, 107, 108, 99, 98, 104, 106, 110, 111]);

  it('enters at the next open and leaves at the next open after the exit signal', () => {
    const t = backtest(breakout, bars, 'X', NO_COSTS);
    expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({
      signalDate: 'd002',
      entryDate: 'd003',
      entryPrice: 107,
      exitDate: 'd006',
      exitPrice: 98,
      reason: 'exit',
      bars: 4,
      open: false,
    });
    expect(t[0]?.ret).toBeCloseTo(98 / 107 - 1, 12);
    expect(t[1]).toMatchObject({
      entryDate: 'd009',
      entryPrice: 110,
      open: true,
      reason: 'end',
      exitPrice: 111,
    });
  });

  it('charges costs on both sides', () => {
    const costs: Costs = { commissionBps: 5, slippageBps: 4, fxBps: 1 }; // 10 bps a side
    const t = backtest(breakout, bars, 'X', costs);
    expect(t[0]?.ret).toBeCloseTo(((98 / 107) * 0.999) / 1.001 - 1, 12);
  });

  it('a percent stop fills at the stop, or at the open when the bar gaps below it', () => {
    const stopRule = noExit(breakout, { stop: { pct: 0.05 }, id: 'stop-test' });
    // Enter d001 at 100; stop 95. d002 trades down to 94 from an open of 97: out at 95.
    const touch = ohlc([
      [104, 106, 103, 106],
      [100, 101, 99, 100],
      [97, 98, 94, 96],
      [96, 96, 96, 96],
    ]);
    expect(backtest(stopRule, touch, 'X', NO_COSTS)[0]).toMatchObject({
      exitPrice: 95,
      reason: 'stop',
      exitDate: 'd002',
    });
    // d002 opens at 93, below the stop: out at 93.
    const gap = ohlc([
      [104, 106, 103, 106],
      [100, 101, 99, 100],
      [93, 94, 90, 92],
      [92, 92, 92, 92],
    ]);
    expect(backtest(stopRule, gap, 'X', NO_COSTS)[0]).toMatchObject({
      exitPrice: 93,
      reason: 'stop',
    });
  });

  it('a new signal on the bar a stop exits can enter on the next open', () => {
    const stopRule = noExit(breakout, { stop: { pct: 0.05 }, id: 'reenter-test' });
    // Signal d000; enter d001 at 100 (stop 95); d001 trades down to 94 (out at 95) and closes at 106, a new
    // signal; enter again at d002's open 107.
    const b = ohlc([
      [104, 106, 103, 106],
      [100, 107, 94, 106],
      [107, 108, 106, 107],
      [107, 107, 107, 107],
    ]);
    const t = backtest(stopRule, b, 'X', NO_COSTS);
    expect(t.map((x) => [x.entryDate, x.reason])).toEqual([
      ['d001', 'stop'],
      ['d002', 'end'],
    ]);
  });

  it('a time stop leaves at the open after the given number of bars', () => {
    const timeRule = noExit(breakout, { maxHoldBars: 3, id: 'time-test' });
    // Signal d000 (106), enter d001; held 3 bars by d003's close; leave at d004's open 104.
    const t = backtest(timeRule, flat([106, 100, 101, 102, 104, 100]), 'X', NO_COSTS);
    expect(t[0]).toMatchObject({
      entryDate: 'd001',
      exitDate: 'd004',
      exitPrice: 104,
      reason: 'time',
      bars: 4,
    });
  });
});

describe('backtest against an independent Python implementation (SMA 10/30 crossover with costs)', () => {
  it('produces the same trades and returns', () => {
    const t = backtest(
      known.rule as RuleDoc,
      known.bars as DailyBar[],
      'SYN',
      known.costs as Costs,
    );
    expect(t.map((x) => [x.signalDate, x.entryDate, x.exitDate, x.reason])).toEqual(
      known.trades.map((x) => [x.signalDate, x.entryDate, x.exitDate, x.reason]),
    );
    t.forEach((x, k) =>
      expect(Math.abs(x.ret - (known.trades[k]?.ret as number))).toBeLessThan(1e-12),
    );
  });
});

describe('look-ahead and determinism', () => {
  it('changing bars after a cut never changes a trade that closed before it', () => {
    const base = known.bars as DailyBar[];
    const before = backtest(known.rule as RuleDoc, base, 'SYN', known.costs as Costs);
    const cut = Math.floor(base.length * 0.6);
    const changed = base.map((b, i) =>
      i > cut
        ? { ...b, open: b.open * 1.3, high: b.high * 1.3, low: b.low * 0.7, close: b.close * 0.8 }
        : b,
    );
    const after = backtest(known.rule as RuleDoc, changed, 'SYN', known.costs as Costs);
    const cutDate = (base[cut] as DailyBar).date;
    const closedBefore = (ts: typeof before) => ts.filter((t) => t.exitDate < cutDate);
    expect(closedBefore(after)).toEqual(closedBefore(before));
  });

  it('two reports with the same seed are identical; another seed differs only in simulations', () => {
    const t = backtest(
      known.rule as RuleDoc,
      known.bars as DailyBar[],
      'SYN',
      known.costs as Costs,
    );
    const many = [...t, ...t, ...t, ...t, ...t, ...t].map((x, k) => ({
      ...x,
      ret: x.ret + k * 1e-5,
    }));
    const a = backtestReport(many, { seed: 5 });
    expect(backtestReport(many, { seed: 5 })).toEqual(a);
    const b = backtestReport(many, { seed: 6 });
    expect(b.stats).toEqual(a.stats);
    expect(b.monteCarlo).not.toEqual(a.monteCarlo);
  });
});

describe('backtestReport', () => {
  it('shows intervals only from 30 trades and breaks down by regime', () => {
    const mk = (n: number, ret: number, date: string) =>
      Array.from({ length: n }, (_, k) => ({
        ticker: 'X',
        signalDate: date,
        entryDate: date,
        entryPrice: 1,
        exitDate: date,
        exitPrice: 1,
        reason: 'exit' as const,
        bars: 1,
        ret: ret + k * 1e-4,
        open: false,
      }));
    // An open trade (data ended) is left out of the statistics.
    const withOpen = backtestReport([
      ...mk(10, 0.01, 'd1'),
      { ...(mk(1, 0.5, 'd2')[0] as ReturnType<typeof mk>[number]), open: true },
    ]);
    expect(withOpen.stats.n).toBe(10);
    const few = backtestReport(mk(10, 0.01, 'd1'));
    expect(few.stats.sufficient).toBe(false);
    expect(few.expectancy.ci90).toBeNull();
    const trades = [...mk(30, 0.01, 'bull'), ...mk(5, -0.02, 'bear')];
    const r = backtestReport(trades, { regimeAt: (d) => d });
    expect(r.expectancy.ci90).not.toBeNull();
    expect(r.byRegime).toEqual([
      { label: 'bear', n: 5, expectancy: null, sufficient: false },
      {
        label: 'bull',
        n: 30,
        expectancy: expect.closeTo(0.01 + (29 * 1e-4) / 2, 12) as unknown as number,
        sufficient: true,
      },
    ]);
    expect(r.monteCarlo?.worst5).toBeLessThanOrEqual(r.monteCarlo?.median ?? 0);
  });

  it('compares with the benchmark over the same dates', () => {
    const t = backtest(breakout, flat([100, 101, 106, 107, 108, 99, 98, 104]), 'X', NO_COSTS);
    const spy = flat([200, 201, 202, 210, 211, 212, 220, 221]);
    // Closed trade d003 to d006: SPY open d003 210, close d006 220.
    expect(backtestReport(t, { benchmark: { ticker: 'SPY', bars: spy } }).benchmark).toEqual({
      ticker: 'SPY',
      ret: 220 / 210 - 1,
    });
  });
});

describe('walk-forward', () => {
  const dates = (known.bars as DailyBar[]).map((b) => b.date);

  it('splits into anchored folds and an untouched final holdout', () => {
    const s = walkForwardSplit(dates, 4, 0.2);
    expect(s.folds).toHaveLength(4);
    for (const f of s.folds) {
      expect(f.train[1] < f.test[0]).toBe(true);
      expect(f.test[1] < s.holdout[0]).toBe(true);
    }
    expect(s.holdout[1]).toBe(dates.at(-1));
    expect(() => walkForwardSplit(dates.slice(0, 20), 4)).toThrow(RangeError);
  });

  it('counts every variant as a trial, chooses on training data, and hides the holdout unless asked', () => {
    const variants: RuleDoc[] = [5, 10, 20].map((p) => ({
      id: `sma-${p}`,
      name: `SMA ${p}`,
      side: 'long',
      entry: { left: { ind: 'close' }, op: 'crossesAbove', right: { ind: 'sma', period: p } },
      exit: { left: { ind: 'close' }, op: 'crossesBelow', right: { ind: 'sma', period: p } },
    }));
    const split = walkForwardSplit(dates, 4, 0.2);
    const w = walkForward(variants, known.bars as DailyBar[], 'SYN', split);
    expect(w.trials).toBe(3);
    expect(w.chosen).toHaveLength(4);
    expect(w.holdout).toBeNull();
    for (const t of w.outOfSample) expect(t.exitDate < split.holdout[0]).toBe(true);
    const shown = walkForward(variants, known.bars as DailyBar[], 'SYN', split, {
      revealHoldout: true,
    });
    for (const t of shown.holdout ?? []) expect(t.signalDate >= split.holdout[0]).toBe(true);
  });
});
