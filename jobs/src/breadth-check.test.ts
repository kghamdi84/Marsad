import { describe, expect, it } from 'vitest';
import { memberBreadth } from './breadth-check.js';

const dates = Array.from({ length: 205 }, (_, i) => `d${String(i).padStart(3, '0')}`);
// Rising: the last close is above its 200-day mean. Falling: below. Short: too little history for 200 sessions.
const rising = { close: dates.map((_, i) => 100 + i), volume: dates.map(() => 1) };
const falling = { close: dates.map((_, i) => 400 - i), volume: dates.map(() => 1) };
const short = { close: dates.map((_, i) => (i < 150 ? null : 50 + i)), volume: dates.map(() => 1) };

describe('memberBreadth', () => {
  it('counts members above the 200- and 50-day means with the breadth-1 rule, only where history allows', () => {
    const series = new Map([
      ['UP', rising],
      ['DOWN', falling],
      ['NEW', short],
    ]);
    const [b] = memberBreadth(dates, series, ['UP', 'DOWN', 'NEW', 'MISSING'], ['d204']);
    expect(b).toEqual({ date: 'd204', members: 3, n200: 2, above200: 1, n50: 3, above50: 2 });
  });

  it('skips a date that is not stored', () => {
    expect(memberBreadth(dates, new Map([['UP', rising]]), ['UP'], ['nope'])).toEqual([]);
  });
});
