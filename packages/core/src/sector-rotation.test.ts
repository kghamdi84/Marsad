import { describe, expect, it } from 'vitest';
import { SECTOR_ROTATION_VERSION, sectorRotation } from './sector-rotation.js';

// 64 consecutive days (dates only need to sort; the function never reads the weekday).
const dates = Array.from({ length: 64 }, (_, i) =>
  new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
);
const bars = (closes: readonly number[], from = 0) =>
  closes.map((close, i) => ({ date: dates[from + i] as string, close }));

// SPY: 100 every day except the newest, 105.
const spy = bars(dates.map((_, i) => (i === 63 ? 105 : 100)));

describe('sectorRotation (hand-checked known answers, tolerance 1e-12)', () => {
  it('relative return over 5, 21 and 63 sessions', () => {
    // Fund A: 100 every day except the newest, 110. Each window: 1.10 / 1.05 - 1 = 1/21.
    const a = bars(dates.map((_, i) => (i === 63 ? 110 : 100)));
    // Fund B: 50 to index 42, 55 to index 58, 60 from index 59.
    //   1 week (index 58 to 63): (60/55) / 1.05 - 1 = (12/11) / (21/20) - 1 = 240/231 - 1 = 3/77.
    //   1 month (index 42 to 63): (60/50) / 1.05 - 1 = 1.2 / 1.05 - 1 = 1/7.
    //   3 months (index 0 to 63): (60/50) / 1.05 - 1 = 1/7.
    const b = bars(dates.map((_, i) => (i <= 42 ? 50 : i <= 58 ? 55 : 60)));
    const r = sectorRotation(
      [
        { ticker: 'XLA', bars: a },
        { ticker: 'XLB', bars: b },
      ],
      spy,
    );
    expect(r.version).toBe(SECTOR_ROTATION_VERSION);
    expect(r.asOf).toBe(dates[63]);
    const [ra, rb] = r.rows;
    expect(ra?.state).toBe('ok');
    expect(ra?.w1).toBeCloseTo(1 / 21, 12);
    expect(ra?.m1).toBeCloseTo(1 / 21, 12);
    expect(ra?.m3).toBeCloseTo(1 / 21, 12);
    expect(rb?.w1).toBeCloseTo(3 / 77, 12);
    expect(rb?.m1).toBeCloseTo(1 / 7, 12);
    expect(rb?.m3).toBeCloseTo(1 / 7, 12);
  });

  it('a fund that falls while SPY rises is negative', () => {
    // 100 to index 58, then 95: (95/100) / 1.05 - 1 = 19/21 - 1 = -2/21 over every window.
    const c = bars(dates.map((_, i) => (i <= 58 ? 100 : 95)));
    const [rc] = sectorRotation([{ ticker: 'XLC', bars: c }], spy).rows;
    expect(rc?.w1).toBeCloseTo(-2 / 21, 12);
    expect(rc?.m3).toBeCloseTo(-2 / 21, 12);
  });

  it('is null for a window longer than the common history', () => {
    // The last 22 days only: 1 week and 1 month (21 + 1 bars) are measured, 3 months is not.
    const short = bars(
      dates.slice(42).map((_, i) => (i === 21 ? 110 : 100)),
      42,
    );
    const [r] = sectorRotation([{ ticker: 'XLD', bars: short }], spy).rows;
    expect(r?.state).toBe('ok');
    expect(r?.w1).toBeCloseTo(1 / 21, 12);
    expect(r?.m1).toBeCloseTo(1 / 21, 12);
    expect(r?.m3).toBeNull();
  });

  it('a fund whose newest bar is older than SPY is stale, with no values', () => {
    const old = bars(dates.slice(0, 63).map(() => 100));
    const [r] = sectorRotation([{ ticker: 'XLE', bars: old }], spy).rows;
    expect(r).toEqual({
      ticker: 'XLE',
      asOf: dates[62],
      state: 'stale',
      w1: null,
      m1: null,
      m3: null,
    });
  });

  it('without bars for the fund or for SPY there is no data', () => {
    const [r] = sectorRotation([{ ticker: 'XLF', bars: [] }], spy).rows;
    expect(r?.state).toBe('no-data');
    const none = sectorRotation([{ ticker: 'XLG', bars: spy }], []);
    expect(none.asOf).toBeNull();
    expect(none.rows[0]?.state).toBe('no-data');
  });
});
