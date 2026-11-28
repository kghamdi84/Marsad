import { describe, expect, it } from 'vitest';
import {
  DIVIDENDS_VERSION,
  dividendSummary,
  inferFrequency,
  type StoredDividend,
} from './dividend-figures.js';

const d = (ex: string, amount: number, more: Partial<StoredDividend> = {}): StoredDividend => ({
  exDividendDate: ex,
  recordDate: null,
  payDate: null,
  declarationDate: null,
  cashAmount: amount,
  splitAdjustedAmount: null,
  currency: 'USD',
  frequency: 4,
  ...more,
});
const quarters = (year: number, amount: number) =>
  ['03-10', '06-10', '09-10', '12-10'].map((md) => d(`${year}-${md}`, amount));

// Quarterly: 0.10 a payment in 2022, 0.11 in 2023, 0.12 in 2024, 0.13 in 2025, 0.14 in 2026 (one still to come).
const ROWS: StoredDividend[] = [
  ...quarters(2022, 0.1),
  ...quarters(2023, 0.11),
  ...quarters(2024, 0.12),
  ...quarters(2025, 0.13),
  d('2026-03-10', 0.14),
  d('2026-06-10', 0.14),
  d('2026-09-10', 0.14),
  d('2026-12-02', 0.14, { recordDate: '2026-12-02', payDate: '2026-12-26' }),
];

describe('dividends-1', () => {
  it('finds the next ex-date, yield, payout ratio and years of growth by hand', () => {
    const s = dividendSummary({
      dividends: ROWS,
      close: 100,
      closeDate: '2026-11-27',
      today: '2026-11-28',
      epsTtm: 2.75,
    });
    expect(s.formulaVersion).toBe(DIVIDENDS_VERSION);
    expect(s.next?.exDividendDate).toBe('2026-12-02');
    expect(s.next?.payDate).toBe('2026-12-26');
    expect(s.frequency).toBe(4);
    expect(s.frequencySource).toBe('stated');
    // 12 months to 27 Nov 2026: 0.13 (Dec 2025) + 3 x 0.14 = 0.55 over a 100 close = 0.55%.
    expect(s.yield?.total).toBeCloseTo(0.55, 12);
    expect(s.yield?.pct).toBeCloseTo(0.55, 12);
    expect(s.yield?.count).toBe(4);
    // 0.55 / 2.75 = 20%.
    expect(s.payoutPct).toBeCloseTo(20, 10);
    // 2025 > 2024 > 2023 > 2022, and 2022 is the start of stored history: at least 3 years.
    expect(s.growth).toEqual({ years: 3, through: 2025, atLeast: true });
    expect(s.historyFrom).toBe('2022-03-10');
    expect(s.annual.map((a) => a.year)).toEqual([2022, 2023, 2024, 2025, 2026]);
  });

  it('skips a partial first year and stops at a year without growth', () => {
    const partial = ROWS.filter((r) => r.exDividendDate >= '2022-09-01');
    expect(
      dividendSummary({
        dividends: partial,
        close: 100,
        closeDate: '2026-11-27',
        today: '2026-11-28',
        epsTtm: null,
      }).growth,
    ).toEqual({ years: 2, through: 2025, atLeast: true });
    const flat = ROWS.map((r) =>
      r.exDividendDate.startsWith('2025') ? { ...r, cashAmount: 0.12 } : r,
    );
    const s = dividendSummary({
      dividends: flat,
      close: 100,
      closeDate: '2026-11-27',
      today: '2026-11-28',
      epsTtm: -1,
    });
    expect(s.growth).toEqual({ years: 0, through: null, atLeast: false });
    // A loss gives no payout ratio.
    expect(s.payoutPct).toBeNull();
  });

  it('uses the split-adjusted amount when the vendor gives one', () => {
    // A 10-for-1 split: 0.40 paid before it is 0.04 on today's basis.
    const rows = [d('2025-12-10', 0.4, { splitAdjustedAmount: 0.04 }), d('2026-03-10', 0.04)];
    const s = dividendSummary({
      dividends: rows,
      close: 8,
      closeDate: '2026-11-27',
      today: '2026-11-28',
      epsTtm: null,
    });
    expect(s.yield?.total).toBeCloseTo(0.08, 12);
    expect(s.yield?.pct).toBeCloseTo(1, 12);
  });

  it('infers the frequency from ex-date gaps when none is stated', () => {
    expect(inferFrequency(['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15'])).toBe(4);
    expect(inferFrequency(['2026-01-15', '2026-02-15', '2026-03-15'])).toBe(12);
    expect(inferFrequency(['2025-06-01', '2026-06-01'])).toBe(1);
    expect(inferFrequency(['2026-06-01'])).toBeNull();
    const s = dividendSummary({
      dividends: ROWS.map((r) => ({ ...r, frequency: null })),
      close: 100,
      closeDate: '2026-11-27',
      today: '2026-11-28',
      epsTtm: null,
    });
    expect(s).toMatchObject({ frequency: 4, frequencySource: 'inferred' });
  });

  it('has nothing to say without dividends', () => {
    const s = dividendSummary({
      dividends: [],
      close: 100,
      closeDate: '2026-11-27',
      today: '2026-11-28',
      epsTtm: 2,
    });
    expect(s.next).toBeNull();
    expect(s.yield?.pct).toBe(0);
    expect(s.payoutPct).toBe(0);
    expect(s.growth.years).toBe(0);
  });
});
