import { describe, expect, it } from 'vitest';
import type { TickerSeries } from './breadth.js';
import type { DailyBar } from './study.js';
import { SECTOR_ETFS, marketMovers, tickerSummary } from './watch.js';

function bars(closes: number[], opts: { volumes?: number[]; lastOpen?: number } = {}): DailyBar[] {
  return closes.map((close, i) => ({
    date: `d${String(i).padStart(3, '0')}`,
    open: i === closes.length - 1 && opts.lastOpen !== undefined ? opts.lastOpen : close,
    high: close,
    low: close,
    close,
    volume: opts.volumes?.[i] ?? 100,
    vwap: null,
  }));
}

describe('tickerSummary (hand-checked)', () => {
  it('computes returns, the opening gap and the volume ratio', () => {
    // 22 bars: closes 100 .. 121; the last opens at 123 after a 120 close, on 3x the usual volume.
    const closes = Array.from({ length: 22 }, (_, i) => 100 + i);
    const volumes = closes.map((_, i) => (i === 21 ? 300 : 100));
    const s = tickerSummary(bars(closes, { volumes, lastOpen: 123 }));
    expect(s).toMatchObject({ date: 'd021', close: 121 });
    expect(s?.change1d).toBeCloseTo(121 / 120 - 1, 12);
    expect(s?.change5d).toBeCloseTo(121 / 116 - 1, 12);
    expect(s?.change21d).toBeCloseTo(121 / 100 - 1, 12);
    expect(s?.gap).toBeCloseTo(123 / 120 - 1, 12);
    expect(s?.volumeRatio20).toBe(3); // 300 against the 20 sessions before it (all 100)
    expect(s?.fromHigh252).toBeNull(); // fewer than 252 bars
  });

  it('measures the distance from the 252-session high', () => {
    // 260 bars rising to 200 at bar 199, then falling to 150: the high in the last 252 is 200.
    const closes = Array.from({ length: 260 }, (_, i) =>
      i < 200 ? i + 1 : 200 - (i - 199) * (50 / 60),
    );
    const s = tickerSummary(bars(closes));
    expect(s?.fromHigh252).toBeCloseTo((closes[259] as number) / 200 - 1, 12);
  });

  it('leaves out what it cannot compute', () => {
    const s = tickerSummary(bars([10]));
    expect(s).toMatchObject({ change1d: null, change5d: null, gap: null, volumeRatio20: null });
    expect(tickerSummary([])).toBeNull();
  });
});

describe('marketMovers (hand-checked)', () => {
  const dates = ['d0', 'd1'];
  const s = (p: number | null, c: number | null, v = 1000): TickerSeries => ({
    close: [p, c],
    volume: [v, v],
  });
  const series = new Map<string, TickerSeries>([
    ['UP10', s(100, 110)],
    ['UP5', s(100, 105)],
    ['FLAT', s(50, 50)],
    ['DN20', s(100, 80)],
    ['DN3', s(100, 97)],
    ['BAD', s(10, 25)], // +150%: a bad print, left out
    ['HALT', s(100, null)], // did not trade
    ['NOTMEMBER', s(100, 200)],
    ['XLK', s(200, 202)],
    ['XLE', s(100, 99)],
  ]);
  const members = new Set(['UP10', 'UP5', 'FLAT', 'DN20', 'DN3', 'BAD', 'HALT']);
  const m = marketMovers(dates, series, members, 1, 2);

  it('ranks members by change, leaving out bad prints, halts and non-members', () => {
    expect(m.n).toBe(5); // UP10, UP5, FLAT, DN20, DN3
    expect(m.gainers.map((x) => x.ticker)).toEqual(['UP10', 'UP5']);
    expect(m.losers.map((x) => x.ticker)).toEqual(['DN20', 'DN3']);
    expect(m.gainers[0]).toMatchObject({ close: 110, dollarVolume: 110_000 });
    expect(m.gainers[0]?.change).toBeCloseTo(0.1, 12);
  });

  it('gives every sector ETF, null when it did not trade', () => {
    expect(m.sectors).toHaveLength(SECTOR_ETFS.length);
    expect(m.sectors.find((x) => x.ticker === 'XLK')?.change).toBeCloseTo(0.01, 12);
    expect(m.sectors.find((x) => x.ticker === 'XLE')?.change).toBeCloseTo(-0.01, 12);
    expect(m.sectors.find((x) => x.ticker === 'XLU')?.change).toBeNull();
  });
});
