import { describe, expect, it } from 'vitest';
import type { ShareChange, TickerSeries } from './breadth.js';
import {
  LIQUIDITY_FLOOR,
  MOVERS_RULES,
  UNUSUAL_VOLUME,
  moversSession,
  type MoversSession,
} from './movers.js';

// Hand-built markets: every number below is checked by hand from the series written here. Tolerance: ratios and
// changes to 12 decimal places (exact arithmetic on small integers otherwise).

/** `n` session dates, one per calendar day from 2026-01-01 (the function only needs them sorted). */
function sessionDates(n: number): string[] {
  return Array.from({ length: n }, (_, k) =>
    new Date(Date.UTC(2026, 0, 1 + k)).toISOString().slice(0, 10),
  );
}

type Col = (number | null)[];
function flat(n: number, close: number, volume: number): { close: Col; volume: Col } {
  return {
    close: new Array<number | null>(n).fill(close),
    volume: new Array<number | null>(n).fill(volume),
  };
}
/** A flat series whose last session closes at `last` on `lastVolume`. */
function ending(n: number, last: number, lastVolume = 100_000, base = 100, baseVolume = 100_000) {
  const s = flat(n, base, baseVolume);
  s.close[n - 1] = last;
  s.volume[n - 1] = lastVolume;
  return s;
}

const view = (
  m: MoversSession,
  floor: number,
  v: keyof MoversSession['floors'][number]['views'],
) => {
  const f = m.floors.find((x) => x.minDollarVolume === floor);
  const r = f?.views[v];
  if (!r) throw new Error(`no ${v} at ${floor}`);
  return r;
};
const tickers = (r: ReturnType<typeof view>, part: 'rows' | 'checks' = 'rows') =>
  r.available ? r[part].map((x) => x.ticker) : null;

describe('moversSession: one session of 22 (hand-checked)', () => {
  const n = 22;
  const dates = sessionDates(n);
  const series = new Map<string, TickerSeries>();
  series.set('UP', ending(n, 110)); // +10%
  series.set('UP2', ending(n, 105)); // +5%
  series.set('TIE', ending(n, 105)); // +5%, ties UP2: TIE sorts first
  series.set('DN', ending(n, 92)); // -8%
  series.set('BIG', ending(n, 100, 10_000_000, 100, 10_000_000)); // 0%, USD 1 billion traded every day
  series.set('WAR', ending(n, 120)); // a warrant: not a common stock or ETF
  series.set('JMP', ending(n, 130)); // +30%: over the 25% corporate-action guard
  const zero = ending(n, 100);
  zero.close[n - 2] = 0; // a zero previous close: bad print
  series.set('ZERO', zero);
  const fresh = ending(n, 100);
  fresh.close[n - 2] = null; // no previous close stored: bad print
  series.set('NEW', fresh);
  series.set('SPL', ending(n, 101)); // +1% after adjustment, but a split executes on the session
  series.set('VOL', ending(n, 101, 400_000)); // 4x the 20-session average of 100,000
  series.set('VOL2', ending(n, 100, 290_000)); // 2.9x: under the 3x minimum
  series.set('THIN', ending(n, 10, 400_000, 10, 40_000)); // 10x, but USD 4 million traded (under 5 million)
  const gap = ending(n, 100, 500_000);
  gap.volume[5] = null; // one of the 20 sessions not stored: no ratio
  series.set('GAP', gap);
  series.set('OLDSPL', ending(n, 100, 400_000)); // 4x, but a split executed inside the 20 sessions
  series.set('PENNY', ending(n, 0.55, 10_000_000, 0.5, 10_000_000)); // +10%, USD 5.5 million, but under USD 1
  series.set('LOWDV', ending(n, 110, 15_000, 100, 15_000)); // +10%, but USD 1.65 million traded (under 2 million)
  const eligible = new Set([...series.keys()].filter((t) => t !== 'WAR'));
  const splits: ShareChange[] = [
    { ticker: 'SPL', executionDate: dates[21] as string, splitFrom: 1, splitTo: 2 },
    { ticker: 'OLDSPL', executionDate: dates[10] as string, splitFrom: 1, splitTo: 3 },
  ];
  const m = moversSession({ dates, series, eligible, eligibleAsOf: '2025-12-01', splits, i: 21 });

  it('counts what it saw and leaves out bad prints', () => {
    expect(m).toMatchObject({
      version: 'movers-1',
      date: dates[21],
      previousDate: dates[20],
      sessions: 22,
      eligibleAsOf: '2025-12-01',
      traded: 16, // every eligible ticker stored on the session
      withChange: 12, // less ZERO and NEW (bad prints) and PENNY and LOWDV (under the liquidity floor)
      withVolumeHistory: 11, // less GAP
      withYearHistory: 0,
      badPrints: { zeroPrice: 1, noPreviousClose: 1, samples: ['NEW', 'ZERO'] },
      belowLiquidity: { price: 1, dollarVolume: 1 },
    });
  });

  it('states its liquidity floor: USD 1 close and USD 2 million traded, the first filter choice', () => {
    expect(LIQUIDITY_FLOOR).toEqual({ minPrice: 1, minDollarVolume: 2_000_000 });
    expect(MOVERS_RULES.dollarVolumeFloors[0]).toBe(LIQUIDITY_FLOOR.minDollarVolume);
    expect(m.rules.liquidity).toEqual(LIQUIDITY_FLOOR);
    for (const f of m.floors)
      for (const r of Object.values(f.views))
        if (r.available)
          for (const x of [...r.rows, ...r.checks]) {
            expect(x.close).toBeGreaterThanOrEqual(1);
            expect(x.dollarVolume).toBeGreaterThanOrEqual(2_000_000);
          }
  });

  it('ranks gainers and losers by change, ties by ticker; flagged moves are checks, not movers', () => {
    const g = view(m, 2_000_000, 'gainers');
    expect(tickers(g)).toEqual(['UP', 'TIE', 'UP2', 'VOL']);
    expect(g.available && g.rows[0]?.change).toBeCloseTo(0.1, 12);
    expect(g.available && g.qualified).toBe(4);
    expect(tickers(g, 'checks')).toEqual(['JMP', 'SPL']);
    expect(g.available && g.checks[0]?.check).toEqual(['move-over-25']);
    expect(g.available && g.checks[1]).toMatchObject({
      check: ['split-on-session'],
      split: { date: dates[21], from: 1, to: 2 },
    });
    const l = view(m, 2_000_000, 'losers');
    expect(tickers(l)).toEqual(['DN']);
    expect(l.available && l.rows[0]?.change).toBeCloseTo(-0.08, 12);
    expect(tickers(l, 'checks')).toEqual([]);
  });

  it('most active by dollar volume, and the minimum dollar-volume filter', () => {
    expect(tickers(view(m, 2_000_000, 'active'))).toEqual([
      'BIG', // 100 x 10,000,000 = 1,000,000,000
      'GAP', // 100 x 500,000
      'VOL', // 101 x 400,000
      'OLDSPL', // 100 x 400,000 (its split only matters to the volume ratio)
      'VOL2',
      'UP', // 110 x 100,000
      'TIE',
      'UP2',
      'DN', // 92 x 100,000
      'THIN', // 10 x 400,000
    ]);
    expect(tickers(view(m, 2_000_000, 'active'), 'checks')).toEqual(['JMP', 'SPL']);
    expect(tickers(view(m, 10_000_000, 'active'))).toEqual([
      'BIG',
      'GAP',
      'VOL',
      'OLDSPL',
      'VOL2',
      'UP',
      'TIE',
      'UP2',
    ]);
    expect(tickers(view(m, 100_000_000, 'active'))).toEqual(['BIG']);
    expect(tickers(view(m, 1_000_000_000, 'gainers'))).toEqual([]);
  });

  it('unusual volume: at least 3x the previous 20 sessions and USD 5 million; a split in the window is a check', () => {
    expect(UNUSUAL_VOLUME).toEqual({ sessions: 20, minRatio: 3, minDollarVolume: 5_000_000 });
    const u = view(m, 2_000_000, 'unusual');
    expect(tickers(u)).toEqual(['VOL']);
    expect(u.available && u.rows[0]?.volumeRatio).toBeCloseTo(4, 12);
    expect(tickers(u, 'checks')).toEqual(['OLDSPL']);
    expect(u.available && u.checks[0]).toMatchObject({
      check: ['split-in-volume-window'],
      split: { date: dates[10], from: 1, to: 3 },
      volumeRatio: 4,
    });
    // VOL2 is under 3x, THIN under USD 5 million, GAP has no ratio.
    const vol2 = view(m, 2_000_000, 'active');
    expect(vol2.available && vol2.rows.find((r) => r.ticker === 'VOL2')?.volumeRatio).toBeCloseTo(
      2.9,
      12,
    );
    expect(vol2.available && vol2.rows.find((r) => r.ticker === 'GAP')?.volumeRatio).toBeNull();
    expect(tickers(view(m, 100_000_000, 'unusual'))).toEqual([]);
  });

  it('marks the 52-week views unavailable with the stored and needed sessions', () => {
    expect(view(m, 2_000_000, 'highs')).toEqual({
      available: false,
      reason: 'history',
      have: 22,
      need: 252,
    });
    expect(view(m, 2_000_000, 'lows')).toEqual({
      available: false,
      reason: 'history',
      have: 22,
      need: 252,
    });
  });

  it('a ticker change on the session is a check in every view; one in the volume window only for unusual volume', () => {
    const t = moversSession({
      dates,
      series,
      eligible,
      splits,
      tickerChanges: [
        { ticker: 'UP', date: dates[21] as string },
        { ticker: 'VOL', date: dates[3] as string },
      ],
      i: 21,
    });
    expect(tickers(view(t, 2_000_000, 'gainers'))).toEqual(['TIE', 'UP2', 'VOL']);
    expect(view(t, 2_000_000, 'gainers')).toMatchObject({
      checks: [
        { ticker: 'JMP' },
        { ticker: 'UP', check: ['ticker-change-on-session'] },
        { ticker: 'SPL' },
      ],
    });
    expect(tickers(view(t, 2_000_000, 'unusual'))).toEqual([]);
    expect(tickers(view(t, 2_000_000, 'unusual'), 'checks')).toEqual(['OLDSPL', 'VOL']);
  });
});

describe('moversSession: history it needs', () => {
  it('shows the 50-session ratio beside the 20-session one once 50 sessions are stored', () => {
    // 51 sessions: volume 100,000 for 30 sessions, 200,000 for the 20 before the last, then 400,000.
    const s = ending(51, 100, 400_000);
    for (let k = 30; k < 50; k++) s.volume[k] = 200_000;
    const at = (i: number) =>
      view(
        moversSession({
          dates: sessionDates(51),
          series: new Map([['A', s]]),
          eligible: new Set(['A']),
          splits: [],
          i,
        }),
        2_000_000,
        'active',
      );
    const r = at(50);
    expect(r.available && r.rows[0]?.volumeRatio).toBeCloseTo(2, 12); // 400 / 200
    expect(r.available && r.rows[0]?.volumeRatio50).toBeCloseTo(400 / 140, 12); // (30 x 100 + 20 x 200) / 50
    const r2 = at(49); // 49 sessions before it: no 50-session average
    expect(r2.available && r2.rows[0]?.volumeRatio50).toBeNull();
  });

  it('unusual volume needs 21 sessions, gainers 2', () => {
    const dates = sessionDates(20);
    const series = new Map<string, TickerSeries>([['A', ending(20, 110, 400_000)]]);
    const m = moversSession({ dates, series, eligible: new Set(['A']), splits: [], i: 19 });
    expect(view(m, 2_000_000, 'unusual')).toEqual({
      available: false,
      reason: 'history',
      have: 20,
      need: 21,
    });
    expect(tickers(view(m, 2_000_000, 'gainers'))).toEqual(['A']);
    const first = moversSession({ dates, series, eligible: new Set(['A']), splits: [], i: 0 });
    expect(view(first, 2_000_000, 'gainers')).toEqual({
      available: false,
      reason: 'history',
      have: 1,
      need: 2,
    });
    expect(first.badPrints.noPreviousClose).toBe(1);
  });
});

describe('moversSession: new 52-week highs and lows (hand-checked)', () => {
  const n = 253;
  const dates = sessionDates(n);
  const series = new Map<string, TickerSeries>();
  const hi = flat(n, 0, 100_000);
  for (let k = 0; k < n; k++) hi.close[k] = 100 + k;
  hi.close[252] = 400; // the 251 sessions before close at most 100 + 251 = 351
  series.set('HI', hi);
  const lo = flat(n, 0, 100_000);
  for (let k = 0; k < n; k++) lo.close[k] = 500 - k;
  lo.close[252] = 240; // the 251 before close at least 500 - 251 = 249
  series.set('LO', lo);
  const eq = flat(n, 100, 100_000);
  eq.close[100] = 90; // ties its prior high of 100 (a tie counts, as in breadth-1); its low is 90
  series.set('EQ', eq);
  const old = ending(n, 101);
  old.close[0] = 1000; // the 1000 close is 252 sessions back: outside the window
  series.set('OLD', old);
  const hole = ending(n, 105);
  hole.close[50] = null; // a session not stored: no full year
  series.set('HOLE', hole);
  series.set('JUMP', ending(n, 130)); // a new high, but +30%: a check
  const eligible = new Set(series.keys());
  const m = moversSession({ dates, series, eligible, splits: [], i: 252 });

  it('ranks new highs and lows with the prior extreme of the 251 sessions before', () => {
    expect(m.withYearHistory).toBe(5);
    const h = view(m, 2_000_000, 'highs');
    expect(tickers(h)).toEqual(['HI', 'OLD', 'EQ']);
    expect(h.available && h.rows[0]?.prior).toBe(351);
    expect(h.available && h.rows[0]?.change).toBeCloseTo(400 / 351 - 1, 12);
    expect(h.available && h.rows[1]?.prior).toBe(100);
    expect(tickers(h, 'checks')).toEqual(['JUMP']);
    const l = view(m, 2_000_000, 'lows');
    expect(tickers(l)).toEqual(['LO']);
    expect(l.available && l.rows[0]?.prior).toBe(249);
  });

  it('needs 252 stored sessions, today included', () => {
    expect(
      view(moversSession({ dates, series, eligible, splits: [], i: 251 }), 2_000_000, 'highs')
        .available,
    ).toBe(true);
    expect(
      view(moversSession({ dates, series, eligible, splits: [], i: 250 }), 2_000_000, 'highs'),
    ).toEqual({
      available: false,
      reason: 'history',
      have: 251,
      need: 252,
    });
  });

  it('keeps at most the stated number of rows', () => {
    const many = new Map<string, TickerSeries>();
    for (let k = 0; k < 20; k++) many.set(`T${String(k).padStart(2, '0')}`, ending(2, 101 + k));
    const r = view(
      moversSession({
        dates: sessionDates(2),
        series: many,
        eligible: new Set(many.keys()),
        splits: [],
        i: 1,
      }),
      2_000_000,
      'gainers',
    );
    expect(r.available && r.rows.length).toBe(MOVERS_RULES.rows);
    expect(r.available && r.qualified).toBe(20);
    expect(tickers(r)?.[0]).toBe('T19');
  });
});
