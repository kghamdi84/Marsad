import { describe, expect, it } from 'vitest';
import synthetic from '../../../fixtures/breadth/synthetic-breadth.json';
import {
  BREADTH_RULES,
  BREADTH_VERSION,
  adjustForSplits,
  advanceShare,
  breadthHistory,
  breadthOn,
  breadthReading,
  breadthSignals,
  monthStarts,
  rankUniverse,
  type BreadthDay,
  type TickerSeries,
} from './breadth.js';

const flat = (n: number, v: number): number[] => Array.from({ length: n }, () => v);

describe('ranking the universe', () => {
  // 21 sessions; the rebuild is at session 20 and uses sessions 0 to 19 only.
  const dates = Array.from({ length: 21 }, (_, i) => `d${String(i).padStart(2, '0')}`);
  const s = (close: number, volume: number, gapsAt: number[] = []): TickerSeries => ({
    close: dates.map((_, i) => (gapsAt.includes(i) ? null : close)),
    volume: dates.map((_, i) => (gapsAt.includes(i) ? null : volume)),
  });
  it('orders by average dollar volume over the 20 sessions before the rebuild, and never uses the rebuild day', () => {
    const series = new Map<string, TickerSeries>([
      ['AAA', s(10, 1000)], // $10,000 a day
      ['BBB', s(50, 1000)], // $50,000
      ['CCC', { close: [...flat(20, 1), 1000], volume: [...flat(20, 1), 1e9] }], // huge only on the rebuild day
    ]);
    const u = rankUniverse(series, new Set(['AAA', 'BBB', 'CCC']), 20, 2);
    expect(u).toEqual([
      { ticker: 'BBB', dollarVolume: 50000, rank: 1 },
      { ticker: 'AAA', dollarVolume: 10000, rank: 2 },
    ]);
  });
  it('leaves out a ticker that is not a common stock or ETF, or traded on fewer than 15 of the 20 sessions', () => {
    const series = new Map<string, TickerSeries>([
      ['AAA', s(10, 1000)],
      ['WRT', s(99, 9999)], // not eligible (say, a warrant)
      ['NEW', s(99, 9999, [0, 1, 2, 3, 4, 5])], // 14 sessions of 20
      ['OLD', s(99, 9999, [0, 1, 2, 3, 4])], // 15 sessions: enough
    ]);
    const u = rankUniverse(series, new Set(['AAA', 'NEW', 'OLD']), 20);
    expect(u.map((m) => m.ticker)).toEqual(['OLD', 'AAA']);
    expect(BREADTH_RULES.minRankSessions).toBe(15);
  });
  it('breaks a tie by ticker, so the result never depends on the order of the input', () => {
    const series = new Map<string, TickerSeries>([
      ['ZZZ', s(10, 1000)],
      ['AAA', s(10, 1000)],
    ]);
    expect(rankUniverse(series, new Set(['ZZZ', 'AAA']), 20).map((m) => m.ticker)).toEqual([
      'AAA',
      'ZZZ',
    ]);
  });
  it('has nothing to rank before 20 sessions exist', () => {
    expect(rankUniverse(new Map([['AAA', s(10, 1000)]]), new Set(['AAA']), 19)).toEqual([]);
  });
  it('builds the first universe at a month start with exactly 20 sessions before it', () => {
    // 20 January sessions, then February 2 at index 20.
    const dates = [
      ...Array.from({ length: 20 }, (_, i) => `2026-01-${String(i + 2).padStart(2, '0')}`),
      '2026-02-02',
    ];
    const one: TickerSeries = { close: flat(21, 10), volume: flat(21, 100) };
    const h = breadthHistory(dates, new Map([['AAA', one]]), () => new Set(['AAA']));
    expect(h.universes.map((u) => [u.at, u.date])).toEqual([[20, '2026-02-02']]);
    expect(h.days.map((d) => d.date)).toEqual(['2026-02-02']);
  });
  it('finds the first session of each month', () => {
    expect(monthStarts(['2026-01-30', '2026-02-02', '2026-02-03', '2026-03-02'])).toEqual([
      0, 1, 3,
    ]);
  });
});

describe('breadth on one day (hand-checked)', () => {
  // 253 sessions so the 252-session high and low can be judged on the last day (index 252).
  const n = 253;
  const dates = Array.from({ length: n }, (_, i) => `s${i}`);
  const rising = Array.from({ length: n }, (_, i) => 100 + i); // a new high every day
  const falling = Array.from({ length: n }, (_, i) => 500 - i); // a new low every day
  const series = new Map<string, TickerSeries>([
    ['UP', { close: rising, volume: flat(n, 10) }],
    ['DOWN', { close: falling, volume: flat(n, 20) }],
    ['FLAT', { close: flat(n, 50), volume: flat(n, 30) }],
    ['JUMP', { close: [...flat(n - 1, 10), 16], volume: flat(n, 40) }], // +60%: a bad print
    ['YOUNG', { close: [...Array<null>(n - 60).fill(null), ...flat(60, 5)], volume: flat(n, 1) }],
  ]);
  const d = breadthOn(dates, series, ['UP', 'DOWN', 'FLAT', 'JUMP', 'YOUNG', 'GONE'], n - 1);
  it('counts advancers, decliners and unchanged with their volume, and sets aside a bad print', () => {
    expect(d).toMatchObject({
      version: BREADTH_VERSION,
      members: 6, // GONE has no data at all but is still a member
      withChange: 4, // UP, DOWN, FLAT, YOUNG
      advancers: 1,
      decliners: 1,
      unchanged: 2,
      upVolume: 10,
      downVolume: 20,
      suspect: 1, // JUMP moved 60%
    });
    expect(advanceShare(d)).toBe(0.5);
  });
  it('judges the averages and the 252-session high and low only with enough history', () => {
    // UP is above both averages, DOWN below, FLAT equal (not above); YOUNG has 60 sessions: only the 50-day.
    expect(d).toMatchObject({ n50: 4, above50: 1, n200: 3, above200: 1, n252: 3 });
    // UP is at a new high; DOWN at a new low; FLAT equals both its high and its low.
    expect(d).toMatchObject({ newHighs: 2, newLows: 2 });
  });
});

describe('Zweig breadth thrust and the McClellan volume oscillator', () => {
  const day = (adv: number, dec: number, up = 1, down = 1): BreadthDay => ({
    date: '',
    version: BREADTH_VERSION,
    members: adv + dec,
    withChange: adv + dec,
    advancers: adv,
    decliners: dec,
    unchanged: 0,
    upVolume: up,
    downVolume: down,
    above50: 0,
    n50: 0,
    above200: 0,
    n200: 0,
    newHighs: 0,
    newLows: 0,
    n252: 0,
    suspect: 0,
  });
  it('fires on the first day the 10-session average is above 0.615 after being below 0.40 in the 10 sessions before', () => {
    // 10 days at 0.30, then days at 1.0: the average climbs 0.37, 0.44, 0.51, 0.58 (not enough), then 0.65 on session 14.
    const days = [
      ...Array.from({ length: 10 }, () => day(3, 7)),
      ...Array.from({ length: 8 }, () => day(10, 0)),
    ];
    const s = breadthSignals(days);
    expect(s[9]?.advanceAvg10).toBeCloseTo(0.3, 12);
    expect(s[13]?.advanceAvg10).toBeCloseTo(0.58, 12);
    expect(s[14]?.advanceAvg10).toBeCloseTo(0.65, 12);
    expect(s.map((x, i) => (x.zweigThrust ? i : -1)).filter((i) => i >= 0)).toEqual([14]);
  });
  it('needs the average strictly above 0.615: 0.61 does not fire, 0.62 does', () => {
    // 10 sessions at 0.30, then 10 at x: the 20th session's average is x itself, with the 0.30 low 10 sessions back.
    const run = (adv: number) =>
      breadthSignals([
        ...Array.from({ length: 10 }, () => day(30, 70)),
        ...Array.from({ length: 10 }, () => day(adv, 100 - adv)),
      ]);
    expect(run(61).some((x) => x.zweigThrust)).toBe(false);
    const s = run(62);
    expect(s[19]?.advanceAvg10).toBeCloseTo(0.62, 12);
    expect(s.map((x, i) => (x.zweigThrust ? i : -1)).filter((i) => i >= 0)).toEqual([19]);
  });
  it('does not fire when the low was more than 10 sessions before, or when the average never fell below 0.40', () => {
    const slow = [
      ...Array.from({ length: 10 }, () => day(3, 7)),
      ...Array.from({ length: 12 }, () => day(5, 5)),
      ...Array.from({ length: 10 }, () => day(10, 0)),
    ];
    expect(breadthSignals(slow).some((x) => x.zweigThrust)).toBe(false);
    const mild = [
      ...Array.from({ length: 10 }, () => day(45, 55)),
      ...Array.from({ length: 10 }, () => day(10, 0)),
    ];
    expect(breadthSignals(mild).some((x) => x.zweigThrust)).toBe(false);
  });
  it('the volume ratio is (up - down) / (up + down); the oscillator needs 39 sessions and sums from its first day', () => {
    const days = Array.from({ length: 41 }, () => day(1, 1, 3, 1)); // ratio 0.5 every day
    const s = breadthSignals(days);
    expect(s[0]?.volumeRatio).toBe(0.5);
    expect(s[37]?.mcclellanOscillator).toBeNull();
    // Both averages of a constant are the constant, so the oscillator is 0 and the sum stays 0.
    expect(s[38]?.mcclellanOscillator).toBeCloseTo(0, 12);
    expect(s[40]?.mcclellanSummation).toBeCloseTo(0, 12);
  });
});

describe('the whole history against an independent Python implementation (synthetic market, seeded)', () => {
  type Raw = { close: (number | null)[]; volume: (number | null)[] };
  const series = new Map<string, TickerSeries>(
    Object.entries(synthetic.series as Record<string, Raw>).map(([t, s]) => [t, s]),
  );
  const eligible = new Set(synthetic.eligible);
  const h = breadthHistory(synthetic.dates, series, () => eligible, synthetic.size);
  const expected = synthetic.expected;

  it('rebuilds the same universes each month', () => {
    expect(h.universes.map((u) => [u.at, u.date])).toEqual(
      expected.universes.map((u) => [u.at, u.date]),
    );
    h.universes.forEach((u, k) => {
      const e = expected.universes[k];
      expect(u.members.map((m) => m.ticker)).toEqual(e?.members.map((m) => m.ticker));
      u.members.forEach((m, j) =>
        expect(m.dollarVolume).toBeCloseTo(e?.members[j]?.dollarVolume ?? NaN, 6),
      );
    });
  });
  it('computes the same breadth on every one of the 308 days', () => {
    expect(h.days).toHaveLength(308);
    expect(h.days).toEqual(expected.days);
  });
  it('the data exercises the hard cases: a bad print, a halt, a late listing, a flat line and a thrust', () => {
    expect(h.days.reduce((s, d) => s + d.suspect, 0)).toBe(1);
    expect(h.days.some((d) => d.unchanged > 0)).toBe(true);
    expect(Math.max(...h.days.map((d) => d.n252))).toBe(11); // the halted ticker never has 252 clean sessions
  });
  it('gives the same signals, including one Zweig thrust', () => {
    const s = breadthSignals(h.days);
    expect(s.filter((x) => x.zweigThrust)).toHaveLength(1);
    s.forEach((x, i) => {
      const e = expected.signals[i] as unknown as Record<string, number | boolean | null>;
      expect(x.zweigThrust).toBe(e['zweigThrust']);
      for (const k of [
        'advanceAvg10',
        'volumeRatio',
        'mcclellanOscillator',
        'mcclellanSummation',
      ] as const) {
        const want = e[k] as number | null;
        if (want === null) expect(x[k]).toBeNull();
        else expect(x[k]).toBeCloseTo(want, 9);
      }
    });
  });
});

describe('split adjustment of raw snapshots', () => {
  const dates = ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04'];
  it('a 2-for-1 split on 06-03 halves earlier closes and doubles earlier volumes, and leaves the rest alone', () => {
    const raw = new Map<string, TickerSeries>([
      ['NVDA', { close: [200, 202, 101, 102], volume: [10, 10, 20, 20] }],
      ['AAPL', { close: [5, 6, 7, 8], volume: [1, 1, 1, 1] }],
    ]);
    const adj = adjustForSplits(dates, raw, [
      { ticker: 'NVDA', executionDate: '2026-06-03', splitFrom: 1, splitTo: 2 },
    ]);
    expect(adj.get('NVDA')).toEqual({ close: [100, 101, 101, 102], volume: [20, 20, 20, 20] });
    expect(adj.get('AAPL')).toBe(raw.get('AAPL')); // untouched, not copied
    // With the adjustment the 06-03 move is +0%, not a 50% crash that would be read as a bad print or a new low.
  });
  it('a 1-for-10 reverse split multiplies earlier closes by 10; two splits multiply; a gap stays a gap', () => {
    const raw = new Map<string, TickerSeries>([
      ['RVS', { close: [1, null, 10, 11], volume: [1000, null, 100, 100] }],
    ]);
    const adj = adjustForSplits(dates, raw, [
      { ticker: 'RVS', executionDate: '2026-06-03', splitFrom: 10, splitTo: 1 },
      { ticker: 'RVS', executionDate: '2026-06-04', splitFrom: 1, splitTo: 2 },
    ]);
    // Session 0 is before both: x10 then x0.5 = x5. Session 2 is before only the second: x0.5.
    expect(adj.get('RVS')).toEqual({ close: [5, null, 5, 11], volume: [200, null, 200, 100] });
  });
  it('ignores a malformed ratio instead of dividing by zero', () => {
    const raw = new Map<string, TickerSeries>([
      ['X', { close: [1, 2, 3, 4], volume: [1, 1, 1, 1] }],
    ]);
    const adj = adjustForSplits(dates, raw, [
      { ticker: 'X', executionDate: '2026-06-03', splitFrom: 0, splitTo: 2 },
    ]);
    expect(adj.get('X')).toEqual(raw.get('X'));
  });
});

describe('the headline reading of a breadth day', () => {
  it('percentages out of the members with enough history, net new highs and the up-volume share', () => {
    const r = breadthReading({
      date: '2026-11-24',
      version: BREADTH_VERSION,
      members: 1000,
      withChange: 990,
      advancers: 600,
      decliners: 380,
      unchanged: 10,
      upVolume: 3e9,
      downVolume: 1e9,
      above50: 450,
      n50: 900, // 50%
      above200: 300,
      n200: 800, // 37.5%
      newHighs: 40,
      newLows: 15,
      n252: 700,
      suspect: 0,
    });
    expect(r).toEqual({
      date: '2026-11-24',
      pctAbove50: 50,
      pctAbove200: 37.5,
      netNewHighs: 25,
      upVolumePct: 75,
    });
  });
  it('no member with the history gives null, not 0%', () => {
    const r = breadthReading({
      date: 'x',
      version: BREADTH_VERSION,
      members: 0,
      withChange: 0,
      advancers: 0,
      decliners: 0,
      unchanged: 0,
      upVolume: 0,
      downVolume: 0,
      above50: 0,
      n50: 0,
      above200: 0,
      n200: 0,
      newHighs: 0,
      newLows: 0,
      n252: 0,
      suspect: 0,
    });
    expect([r.pctAbove50, r.pctAbove200, r.upVolumePct]).toEqual([null, null, null]);
  });
});
