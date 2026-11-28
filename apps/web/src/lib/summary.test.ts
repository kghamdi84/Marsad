import { describe, expect, it } from 'vitest';
import { tickerDailySummary, type DailyBar } from '@marsad/core';
import { figuresOf, isCurrent, toSummary, type StoredSummary } from './summary';

const bar = (date: string, close: number): DailyBar => ({
  date,
  open: close,
  high: close + 1,
  low: close - 1,
  close,
  volume: 1000,
  vwap: null,
});
const bars = [bar('2026-11-25', 10), bar('2026-11-26', 11), bar('2026-11-27', 12)];
const stored = (closeDate: string): StoredSummary => ({
  ...tickerDailySummary({
    ticker: 'ABC',
    date: closeDate,
    coverage: 'tracked',
    bars: bars.filter((b) => b.date <= closeDate),
    spy: null,
  }),
  return_1w: 0.5,
  computed_at: '2026-11-28T11:25:00+00:00',
});

describe('summary rows on the pages', () => {
  it('uses a row only when its close date is not older than the newest bar held', () => {
    expect(isCurrent(stored('2026-11-27'), bars)).toBe(true);
    expect(isCurrent(stored('2026-11-26'), bars)).toBe(false);
    expect(isCurrent(undefined, bars)).toBe(false);
    // A page that holds no bars takes the row as it is.
    expect(isCurrent(stored('2026-11-26'), [])).toBe(true);
  });

  it('says where the figures came from, and computes a missing or stale row with the job function', () => {
    const fresh = figuresOf('ABC', stored('2026-11-27'), bars, null);
    expect(fresh.from).toEqual({
      kind: 'summary',
      date: '2026-11-27',
      computedAt: '2026-11-28T11:25:00+00:00',
    });
    expect(fresh.row.return_1w).toBe(0.5);
    const stale = figuresOf('ABC', stored('2026-11-26'), bars, null);
    expect(stale.from).toEqual({ kind: 'bars', why: 'stale' });
    expect(stale.row).toEqual(
      tickerDailySummary({
        ticker: 'ABC',
        date: '2026-11-27',
        coverage: 'tracked',
        bars,
        spy: null,
        research: null,
        dividends: null,
        earningsEstimate: null,
      }),
    );
    expect(figuresOf('ABC', undefined, bars, null).from).toEqual({ kind: 'bars', why: 'missing' });
  });

  it('reads numeric columns sent as text as numbers and keeps nulls', () => {
    const r = toSummary({
      version: 'ticker-summary-1',
      date: '2026-11-27',
      ticker: 'ABC',
      coverage: 'tracked',
      close: '12.50',
      close_date: '2026-11-27',
      above_sma_50: true,
      rsi_14: null,
      next_earnings_date: '2026-12-03',
      computed_at: '2026-11-28T11:25:00+00:00',
    });
    expect(r.close).toBe(12.5);
    expect(r.above_sma_50).toBe(true);
    expect(r.rsi_14).toBeNull();
    expect(r.return_1y).toBeNull();
    expect(r.next_earnings_date).toBe('2026-12-03');
    expect(r.unavailable).toEqual({});
  });
});
