import { describe, expect, it } from 'vitest';
import {
  DIVIDEND_COMPARE_VERSION,
  DIVIDEND_PROJECTION_METHOD,
  dividendCompare,
  historicalTotalReturn,
  type DividendCompareTicker,
} from './dividend-compare.js';
import { DIVIDEND_CALC_VERSION } from './dividend-calc.js';
import type { StoredDividend } from './dividend-figures.js';
import { DIVIDEND_WITHHOLDING } from './portfolio-check.js';
import type { DailyBar } from './study.js';

/** `n` weekday session dates from `start` (exchange holidays are not needed for these fixtures). */
function weekdays(n: number, start = '2025-01-06'): string[] {
  const out: string[] = [];
  let t = Date.parse(`${start}T00:00:00Z`);
  while (out.length < n) {
    const d = new Date(t).getUTCDay();
    if (d !== 0 && d !== 6) out.push(new Date(t).toISOString().slice(0, 10));
    t += 86_400_000;
  }
  return out;
}

const bar = (date: string, close: number): DailyBar => ({
  date,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1_000_000,
  vwap: null,
});

const div = (exDividendDate: string, amount: number, extra: Partial<StoredDividend> = {}) =>
  ({
    exDividendDate,
    recordDate: null,
    payDate: null,
    declarationDate: null,
    cashAmount: amount,
    splitAdjustedAmount: amount,
    currency: 'USD',
    frequency: 4,
    ...extra,
  }) satisfies StoredDividend;

const near = (v: number | null | undefined, want: number, tol = 1e-9) =>
  expect(Math.abs((v ?? NaN) - want)).toBeLessThan(tol);

describe('historicalTotalReturn (dividend-compare-1)', () => {
  // 253 sessions: 100 for 252 closes, then 110. One dividend of 2 at session 100 (close 100).
  const dates = weekdays(253);
  const bars = dates.map((d, i) => bar(d, i === 252 ? 110 : 100));
  const dividends = [{ exDividendDate: dates[100] as string, amount: 2, currency: 'USD' }];
  const run = (drip: boolean, tax: number) =>
    historicalTotalReturn({ amount: 10_000, bars, dividends, sessions: 252, drip, tax });

  it('hand-checked: cash kept, no tax: (110 + 2) / 100 - 1 = 12%', () => {
    const r = run(false, 0);
    if (!r.available) throw new Error(r.reason);
    near(r.totalReturnPct, 12);
    near(r.priceChangePct, 10);
    near(r.endBalance, 11_200, 1e-6);
    expect(r.payments).toBe(1);
    expect(r.from).toBe(dates[0]);
    expect(r.to).toBe(dates[252]);
  });

  it('hand-checked: DRIP, no tax: 1.02 * 1.10 - 1 = 12.2%', () => {
    const r = run(true, 0);
    if (!r.available) throw new Error(r.reason);
    near(r.totalReturnPct, 12.2);
  });

  it('hand-checked: 30% withholding: cash 11.4%, DRIP 1.014 * 1.10 - 1 = 11.54%', () => {
    const c = run(false, 0.3);
    const d = run(true, 0.3);
    if (!c.available || !d.available) throw new Error('unavailable');
    near(c.totalReturnPct, 11.4);
    near(d.totalReturnPct, 11.54);
    near(c.dividendsNetPerShare, 1.4);
  });

  it('a dividend on the first close of the window is not counted (it was paid to the seller)', () => {
    const r = historicalTotalReturn({
      amount: 100,
      bars,
      dividends: [{ exDividendDate: dates[0] as string, amount: 5, currency: 'USD' }],
      sessions: 252,
      drip: false,
      tax: 0,
    });
    if (!r.available) throw new Error(r.reason);
    expect(r.payments).toBe(0);
    near(r.totalReturnPct, 10);
  });

  it('null with a reason when history is short', () => {
    const r = run(false, 0);
    const y3 = historicalTotalReturn({
      amount: 10_000,
      bars,
      dividends,
      sessions: 756,
      drip: false,
      tax: 0,
    });
    expect(r.available).toBe(true);
    expect(y3).toEqual({
      available: false,
      sessions: 756,
      reason: 'needs 757 sessions of closes, 253 stored',
      needs: 757,
      have: 253,
    });
  });

  it('null when a dividend in the window is not in US dollars', () => {
    const r = historicalTotalReturn({
      amount: 100,
      bars,
      dividends: [{ exDividendDate: dates[50] as string, amount: 1, currency: 'CAD' }],
      sessions: 252,
      drip: false,
      tax: 0,
    });
    expect(r.available).toBe(false);
  });
});

describe('dividendCompare (dividend-compare-1)', () => {
  it('fixed-price projection, hand-checked: 10,000 at 50, 0.50 a quarter, 1 year, no tax', () => {
    const dates = weekdays(260);
    const t: DividendCompareTicker = {
      ticker: 'AAA',
      price: 50,
      priceDate: dates.at(-1) as string,
      priceChange1y: 0,
      bars: dates.map((d) => bar(d, 50)),
      dividends: [60, 120, 180, 240].map((i) => div(dates[i] as string, 0.5)),
    };
    const cash = dividendCompare({
      amount: 10_000,
      years: 1,
      drip: false,
      taxPct: 0,
      tickers: [t],
    });
    const drip = dividendCompare({ amount: 10_000, years: 1, drip: true, taxPct: 0, tickers: [t] });
    if (!cash.ok || !drip.ok) throw new Error('not ok');
    expect(cash.formulaVersion).toBe(DIVIDEND_COMPARE_VERSION);
    expect(cash.formulaVersions['projection']).toBe(DIVIDEND_CALC_VERSION);
    expect(cash.method).toBe("today's price and yield held fixed; price moves not included");
    const c = cash.rows[0]!;
    near(c.yieldPct, 4);
    expect(c.payoutsPerYear).toBe(4);
    near(c.projection?.startShares, 200);
    near(c.projection?.endShares, 200);
    near(c.projection?.annualIncomeGross, 400, 1e-6);
    near(c.projection?.endBalance, 10_400, 1e-6);
    near(c.projection?.totalReturnPct, 4, 1e-9);
    // DRIP at a fixed price: each quarter's 1% buys 1% more shares, so the balance is 10,000 * 1.01^4.
    const d = drip.rows[0]!;
    near(d.projection?.endBalance, 10_000 * 1.01 ** 4, 1e-6);
    near(d.projection?.annualIncomeGross, 100 + 101 + 102.01 + 103.0301, 1e-6);
    near(d.projection?.endShares, 200 * 1.01 ** 4, 1e-9);
  });

  it("withholding defaults to the calculator's DIVIDEND_WITHHOLDING", () => {
    const dates = weekdays(260);
    const r = dividendCompare({
      amount: 10_000,
      years: 1,
      drip: false,
      tickers: [
        {
          ticker: 'AAA',
          price: 50,
          priceDate: dates.at(-1) as string,
          priceChange1y: null,
          bars: dates.map((d) => bar(d, 50)),
          dividends: [60, 120, 180, 240].map((i) => div(dates[i] as string, 0.5)),
        },
      ],
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.taxPct).toBe(DIVIDEND_WITHHOLDING * 100);
    const p = r.rows[0]!.projection!;
    near(p.annualIncomeNet, 400 * (1 - DIVIDEND_WITHHOLDING), 1e-6);
    near(p.tax, 400 * DIVIDEND_WITHHOLDING, 1e-6);
  });

  it('ORC shape (TipRanks): the projection is large and positive while the price fell a third and the real 1-year return is negative', () => {
    // Hand-built: 253 sessions, the close falls evenly from 12 to 8 (-33.3%); 0.12 a month, so the trailing yield
    // on 8 is 12 * 0.12 / 8 = 18%. Ten years, DRIP, 30% withholding.
    const dates = weekdays(253);
    const bars = dates.map((d, i) => bar(d, 12 - (4 * i) / 252));
    const dividends = Array.from({ length: 12 }, (_, k) =>
      div(dates[21 * (k + 1)] as string, 0.12, { frequency: 12 }),
    );
    const r = dividendCompare({
      amount: 10_000,
      years: 10,
      drip: true,
      tickers: [
        {
          ticker: 'ORC',
          price: 8,
          priceDate: dates[252] as string,
          priceChange1y: 8 / 12 - 1,
          bars,
          dividends,
        },
      ],
    });
    if (!r.ok) throw new Error(r.reason);
    const o = r.rows[0]!;
    near(o.yieldPct, 18, 1e-9);
    expect(o.payoutsPerYear).toBe(12);
    near(o.priceChange1yPct, -100 / 3, 1e-9);
    expect(o.projection!.totalReturnPct).toBeGreaterThan(200);
    expect(r.method).toBe(DIVIDEND_PROJECTION_METHOD);
    const y1 = o.historical.y1;
    if (!y1.available) throw new Error(y1.reason);
    near(y1.priceChangePct, -100 / 3, 1e-9);
    expect(y1.totalReturnPct).toBeLessThan(0);
    // Dividends soften the fall but do not undo it: 12 net payments of 0.084 on shares bought at 12.
    expect(y1.totalReturnPct).toBeGreaterThan(-100 / 3);
    expect(o.historical.y3.available).toBe(false);
  });

  it('uses the split factor for a dividend without a split-adjusted amount', () => {
    // A 2-for-1 split after the dividend: 4.00 paid before the split is 2.00 on today's share basis.
    const dates = weekdays(253);
    const bars = dates.map((d, i) => bar(d, i === 252 ? 110 : 100));
    const r = dividendCompare({
      amount: 10_000,
      years: 1,
      drip: false,
      taxPct: 0,
      tickers: [
        {
          ticker: 'SPL',
          price: 110,
          priceDate: dates[252] as string,
          priceChange1y: 0.1,
          bars,
          dividends: [div(dates[100] as string, 4, { splitAdjustedAmount: null })],
          splits: [
            {
              ticker: 'SPL',
              executionDate: dates[200] as string,
              splitFrom: 1,
              splitTo: 2,
              adjustmentType: 'forward_split',
            },
          ],
        },
      ],
    });
    if (!r.ok) throw new Error(r.reason);
    const y1 = r.rows[0]!.historical.y1;
    if (!y1.available) throw new Error(y1.reason);
    near(y1.totalReturnPct, 12);
  });

  it('a ticker with no dividends: zero yield, no payouts a year, projection flat', () => {
    const dates = weekdays(30);
    const r = dividendCompare({
      amount: 1_000,
      years: 5,
      drip: true,
      tickers: [
        {
          ticker: 'NOD',
          price: 20,
          priceDate: dates.at(-1) as string,
          priceChange1y: null,
          bars: dates.map((d) => bar(d, 20)),
          dividends: [],
        },
      ],
    });
    if (!r.ok) throw new Error(r.reason);
    const n = r.rows[0]!;
    expect(n.yieldPct).toBe(0);
    expect(n.payoutsPerYear).toBeNull();
    near(n.projection?.totalReturnPct, 0);
    expect(n.priceChange1yPct).toBeNull();
    expect(n.historical.y1).toMatchObject({ available: false, needs: 253, have: 30 });
  });

  it('no stored price: projection null with the reason, history still computed', () => {
    const dates = weekdays(253);
    const r = dividendCompare({
      amount: 1_000,
      years: 5,
      drip: false,
      tickers: [
        {
          ticker: 'NOP',
          price: null,
          priceDate: null,
          priceChange1y: null,
          bars: dates.map((d) => bar(d, 20)),
          dividends: [],
        },
      ],
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.rows[0]!.projection).toBeNull();
    expect(r.rows[0]!.projectionUnavailable).toBe('no stored price');
    expect(r.rows[0]!.historical.y1.available).toBe(true);
  });

  it('bars after the stored price date are not used (point in time)', () => {
    const dates = weekdays(260);
    const bars = dates.map((d, i) => bar(d, i <= 252 ? 100 : 500));
    const r = dividendCompare({
      amount: 1_000,
      years: 1,
      drip: false,
      tickers: [
        {
          ticker: 'PIT',
          price: 100,
          priceDate: dates[252] as string,
          priceChange1y: 0,
          bars,
          dividends: [],
        },
      ],
    });
    if (!r.ok) throw new Error(r.reason);
    const y1 = r.rows[0]!.historical.y1;
    if (!y1.available) throw new Error(y1.reason);
    expect(y1.to).toBe(dates[252]);
    near(y1.totalReturnPct, 0);
  });

  it('rejects a bad amount, period or tax', () => {
    const base = { years: 5, drip: false, tickers: [] };
    expect(dividendCompare({ ...base, amount: 0 })).toEqual({
      ok: false,
      reason: 'amount must be above zero',
    });
    expect(dividendCompare({ ...base, amount: 1, years: 31 }).ok).toBe(false);
    expect(dividendCompare({ ...base, amount: 1, taxPct: 101 }).ok).toBe(false);
  });

  it('a stated frequency the calculator does not take leaves the projection null with the reason', () => {
    const dates = weekdays(253);
    const r = dividendCompare({
      amount: 1_000,
      years: 1,
      drip: false,
      tickers: [
        {
          ticker: 'WKY',
          price: 10,
          priceDate: dates[252] as string,
          priceChange1y: 0,
          bars: dates.map((d) => bar(d, 10)),
          dividends: [div(dates[250] as string, 0.01, { frequency: 52 })],
        },
      ],
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.rows[0]!.projection).toBeNull();
    expect(r.rows[0]!.projectionUnavailable).toBe('payouts a year (52) is not 1, 2, 4 or 12');
  });
});
