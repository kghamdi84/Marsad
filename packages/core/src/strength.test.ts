import { describe, expect, it } from 'vitest';
import type { TickerSeries } from './breadth.js';
import { STRENGTH_SESSIONS, strengthRanks } from './strength.js';

/** 64 sessions from 100 to `end`, with the given gaps (null closes). */
const path = (end: number, nulls: number[] = []): TickerSeries => ({
  close: Array.from({ length: 64 }, (_, i) =>
    nulls.includes(i) ? null : 100 + ((end - 100) * i) / 63,
  ),
  volume: Array.from({ length: 64 }, () => 1),
});

describe('strengthRanks, hand-checked (strength-1)', () => {
  const series = new Map<string, TickerSeries>([
    ['AAA', path(130)], // +30%
    ['BBB', path(110)], // +10%
    ['CCC', path(110)], // +10%, ties BBB
    ['DDD', path(90)], // -10%
    ['EEE', path(150, [0])], // no close 63 sessions back: left out
  ]);
  const r = strengthRanks(series, ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'ZZZ'], 63);

  it('ranks by 63-session return, best first, with ties sharing a rank', () => {
    expect(r.map((x) => [x.ticker, x.rank])).toEqual([
      ['AAA', 1],
      ['BBB', 2],
      ['CCC', 2],
      ['DDD', 4],
    ]);
    expect(r[0]?.return63).toBeCloseTo(0.3, 12);
    expect(r[3]?.return63).toBeCloseTo(-0.1, 12);
  });

  it('percentile = 100 x (members - rank) / (members - 1), counting only members with a return', () => {
    expect(r.every((x) => x.members === 4)).toBe(true);
    expect(r.map((x) => x.percentile)).toEqual([100, (100 * 2) / 3, (100 * 2) / 3, 0]);
  });

  it('says nothing without a full window, and 100 for a single member', () => {
    expect(strengthRanks(series, ['AAA'], STRENGTH_SESSIONS - 1)).toEqual([]);
    expect(strengthRanks(series, ['AAA'], 63)[0]?.percentile).toBe(100);
  });
});
