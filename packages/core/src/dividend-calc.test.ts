import { describe, expect, it } from 'vitest';
import { DIVIDEND_CALC_VERSION, dividendCalc, dividendCalcCsv } from './dividend-calc.js';

/** Within a cent, as the TipRanks screen rounds. */
const cent = (v: number | undefined, want: number) =>
  expect(Math.abs((v ?? NaN) - want)).toBeLessThan(0.01);

describe('dividend-calc-1', () => {
  it("matches TipRanks' own screen: 60 shares at 145, 5 years, quarterly, no tax or growth", () => {
    const r = dividendCalc({
      price: 145,
      shares: 60,
      years: 5,
      yieldPct: 0.3488641044876089,
      payoutsPerYear: 4,
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.formulaVersion).toBe(DIVIDEND_CALC_VERSION);
    const c = r.cash;
    cent(c.finalYearNet, 30.35);
    cent(c.monthlyIncome, 2.53);
    cent(c.dividendsNet, 151.76);
    cent(c.endValue, 8700);
    cent(c.totalReturnPct, 1.74);
    cent(c.averageAnnualPct, 0.35);
    for (const y of c.years) {
      cent(y.dividendPerShare, 0.51);
      cent(y.dividendsNet, 30.35);
      expect(y.payouts).toBe(4);
      cent(y.valueEnd, 8700);
    }
    const d = r.drip;
    cent(d.finalYearNet, 30.82);
    cent(d.monthlyIncome, 2.57);
    cent(d.dividendsNet, 153.02);
    cent(d.endValue, 8853.02);
    cent(d.totalReturnPct, 1.76);
    cent(d.averageAnnualPct, 0.35);
    expect(c.tax).toBe(0);
    expect(c.deposits).toBe(8700);
  });

  it('takes the dividend tax off every payout (10%)', () => {
    const r = dividendCalc({
      price: 145,
      shares: 60,
      years: 5,
      yieldPct: 0.3488641044876089,
      payoutsPerYear: 4,
      taxPct: 10,
    });
    if (!r.ok) throw new Error(r.reason);
    // Gross 151.756 a 5-year total; tax 15.18; net 136.58. Final year net 30.351 x 0.9 = 27.32.
    cent(r.cash.dividendsGross, 151.76);
    cent(r.cash.tax, 15.18);
    cent(r.cash.dividendsNet, 136.58);
    cent(r.cash.finalYearNet, 27.32);
    cent(r.cash.finalYearGross, 30.35);
  });

  it('grows the dividend and the price by hand: 10 shares at 100, 5% yield, yearly, 10% and 10%, 2 years', () => {
    const r = dividendCalc({
      price: 100,
      shares: 10,
      years: 2,
      yieldPct: 5,
      payoutsPerYear: 1,
      dividendGrowthPct: 10,
      priceGrowthPct: 10,
    });
    if (!r.ok) throw new Error(r.reason);
    // Cash: 10 x 5 = 50, then 10 x 5.5 = 55; end price 121, value 1,210; return (1,210 + 105 - 1,000) / 1,000.
    expect(r.cash.years.map((y) => y.dividendsNet)).toEqual([50, expect.closeTo(55, 10)]);
    expect(r.cash.endValue).toBeCloseTo(1210, 9);
    expect(r.cash.totalReturnPct).toBeCloseTo(31.5, 9);
    expect(r.cash.averageAnnualPct).toBeCloseTo((Math.sqrt(1.315) - 1) * 100, 9);
    // DRIP: 50 buys 50 / 110 shares; 10.4545 x 5.5 = 57.5 buys 57.5 / 121; 10.929752 shares x 121 = 1,322.5.
    expect(r.drip.years[1]?.dividendsNet).toBeCloseTo(57.5, 9);
    expect(r.drip.endValue).toBeCloseTo(1322.5, 9);
    expect(r.drip.totalReturnPct).toBeCloseTo(32.25, 9);
  });

  it('adds contributions at the period price', () => {
    // 1,200 a year in 12 parts of 100 at a flat 50: 24 more shares a year; no yield.
    const r = dividendCalc({
      price: 50,
      shares: 0,
      years: 1,
      yieldPct: 0,
      payoutsPerYear: 4,
      yearlyContribution: 1200,
      contributionsPerYear: 12,
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.cash.years[0]?.sharesEnd).toBeCloseTo(24, 12);
    expect(r.cash.deposits).toBe(1200);
    expect(r.cash.totalReturnPct).toBeCloseTo(0, 12);
  });

  it('rejects inputs it cannot use, with a reason, and never returns NaN', () => {
    const base = { price: 10, shares: 1, years: 1, yieldPct: 1, payoutsPerYear: 4 };
    expect(dividendCalc({ ...base, price: Number.NaN })).toEqual({
      ok: false,
      reason: 'price is not a number',
    });
    expect(dividendCalc({ ...base, shares: -1 })).toEqual({
      ok: false,
      reason: 'shares is negative',
    });
    expect(dividendCalc({ ...base, price: 0 })).toMatchObject({ ok: false });
    expect(dividendCalc({ ...base, years: 31 })).toMatchObject({ ok: false });
    expect(dividendCalc({ ...base, years: 2.5 })).toMatchObject({ ok: false });
    expect(dividendCalc({ ...base, payoutsPerYear: 3 })).toMatchObject({ ok: false });
    expect(dividendCalc({ ...base, taxPct: 120 })).toMatchObject({ ok: false });
    expect(dividendCalc({ ...base, priceGrowthPct: Infinity })).toMatchObject({ ok: false });
    const zero = dividendCalc({ ...base, shares: 0 });
    if (!zero.ok) throw new Error(zero.reason);
    expect(Number.isNaN(zero.cash.totalReturnPct)).toBe(false);
    expect(Number.isNaN(zero.drip.averageAnnualPct)).toBe(false);
  });

  it('writes the yearly table as CSV', () => {
    const r = dividendCalc({ price: 100, shares: 10, years: 1, yieldPct: 5, payoutsPerYear: 1 });
    if (!r.ok) throw new Error(r.reason);
    expect(dividendCalcCsv(r.cash).split('\n')).toEqual([
      'year,shares_start,dividend_per_share,dividends_gross,dividends_net,payouts,contributions,shares_end,price_end,value_end',
      '1,10,5,50,50,1,0,10,100,1000',
    ]);
  });
});
