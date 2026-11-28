import { describe, expect, it } from 'vitest';
import { RECENT_MAX, parseRecent, withViewed } from './recent';

describe('recently viewed', () => {
  it('puts the newest first and drops the repeat', () => {
    expect(withViewed(['NVDA', 'AAPL', 'RKLB'], 'AAPL')).toEqual(['AAPL', 'NVDA', 'RKLB']);
    expect(withViewed([], 'NVDA')).toEqual(['NVDA']);
  });

  it('keeps the last 8', () => {
    const nine = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    expect(RECENT_MAX).toBe(8);
    expect(withViewed(nine, 'I')).toEqual(['I', 'A', 'B', 'C', 'D', 'E', 'F', 'G']);
  });

  it('reads back only ticker-shaped strings, and nothing from a damaged value', () => {
    expect(parseRecent('["NVDA","BRK.B","nvda",7,"NVDA","<b>"]')).toEqual(['NVDA', 'BRK.B']);
    expect(parseRecent('{"a":1}')).toEqual([]);
    expect(parseRecent('not json')).toEqual([]);
    expect(parseRecent(null)).toEqual([]);
  });
});
