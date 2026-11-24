import { describe, expect, it } from 'vitest';
import fixture from '../../../fixtures/gpr-daily-recent.json';
import { parseGprRows, percentileRank } from './gpr.js';

describe('parseGprRows on the recorded GPR rows', () => {
  const { days, skipped } = parseGprRows(fixture.data);
  it('parses all 20 days, in order, ending on the recording date', () => {
    expect(skipped).toEqual([]);
    expect(days).toHaveLength(20);
    expect(days.at(-1)?.date).toBe('2026-11-23');
    const dates = days.map((d) => d.date);
    expect([...dates].sort()).toEqual(dates);
  });
  it('keeps the values exactly', () => {
    expect(days.at(-1)).toMatchObject({
      gprd: 150.144714,
      act: 187.103195,
      threat: 124.850029,
      ma7: 162.345459,
    });
  });
});

describe('parseGprRows validation', () => {
  it('skips bad rows and says why', () => {
    const r = parseGprRows([
      { date: '2026-01-01', GPRD: 100, GPRD_ACT: 90, GPRD_THREAT: 110 },
      { date: 'not a date', GPRD: 1, GPRD_ACT: 1, GPRD_THREAT: 1 },
      { date: '2026-01-02', GPRD: 'x', GPRD_ACT: 1, GPRD_THREAT: 1 },
      { date: '2026-01-03', GPRD: -5, GPRD_ACT: 1, GPRD_THREAT: 1 },
    ]);
    expect(r.days).toHaveLength(1);
    expect(r.skipped.map((s) => s.index)).toEqual([1, 2, 3]);
  });
});

describe('percentileRank', () => {
  it('is the share of history at or below the value', () => {
    expect(percentileRank(3, [1, 2, 3, 4])).toBe(75);
    expect(percentileRank(0, [1, 2, 3, 4])).toBe(0);
    expect(percentileRank(9, [1, 2, 3, 4])).toBe(100);
    expect(percentileRank(1, [])).toBeNull();
  });
});
