import { describe, expect, it } from 'vitest';
import { moved, withTicker } from './watchlist';

describe('watchlist edits', () => {
  it('adds a valid ticker once, at the end, upper case', () => {
    expect(withTicker(['NVDA'], ' pltr ')).toEqual(['NVDA', 'PLTR']);
    expect(withTicker(['NVDA', 'PLTR'], 'pltr')).toEqual(['NVDA', 'PLTR']);
    expect(withTicker(['NVDA'], 'not a ticker')).toBeNull();
  });

  it('moves a ticker one place and leaves the ends alone', () => {
    expect(moved(['A', 'B', 'C'], 'B', -1)).toEqual(['B', 'A', 'C']);
    expect(moved(['A', 'B', 'C'], 'B', 1)).toEqual(['A', 'C', 'B']);
    expect(moved(['A', 'B', 'C'], 'A', -1)).toEqual(['A', 'B', 'C']);
    expect(moved(['A', 'B', 'C'], 'C', 1)).toEqual(['A', 'B', 'C']);
  });
});
