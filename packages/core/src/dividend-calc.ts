/**
 * Dividend calculator (`dividend-calc-1`): a projection from the person's own inputs, not a forecast. Marsad does
 * not predict dividend growth or prices.
 *
 * Model, on a monthly grid over `years` whole years:
 * - Year 1's dividend per share is the start price times the yield; it grows by `dividendGrowthPct` each year.
 * - The price at month m is the start price times (1 + priceGrowthPct) to the power m / 12.
 * - A payout falls every 12 / payoutsPerYear months: shares held times that year's dividend per share divided by
 *   the payouts a year, less `taxPct`. Cash payout keeps it as cash; DRIP buys shares with it at that month's price.
 * - A contribution (yearly amount split evenly over `contributionsPerYear`) buys shares at that month's price, after
 *   the month's payout.
 * Outputs: final-year income (gross and net, and its twelfth as the monthly average), the end value (shares times
 * the end price), total dividends gross, tax and net, total return ((end value plus cash dividends kept, minus
 * deposits) over deposits) and the average annual return ((end value plus cash dividends over deposits) to the
 * power 1 / years, minus 1; with contributions this is a simple approximation, not a money-weighted return).
 */
export const DIVIDEND_CALC_VERSION = 'dividend-calc-1';

export const PAYOUT_FREQUENCIES = [1, 2, 4, 12] as const;
export type PayoutFrequency = (typeof PAYOUT_FREQUENCIES)[number];

export interface DividendCalcInput {
  price: number;
  shares: number;
  years: number;
  yieldPct: number;
  payoutsPerYear: number;
  yearlyContribution?: number;
  contributionsPerYear?: number;
  taxPct?: number;
  dividendGrowthPct?: number;
  priceGrowthPct?: number;
}

export interface DividendCalcYear {
  year: number;
  sharesStart: number;
  dividendPerShare: number;
  dividendsGross: number;
  dividendsNet: number;
  payouts: number;
  contributions: number;
  sharesEnd: number;
  priceEnd: number;
  valueEnd: number;
}

export interface DividendCalcPlan {
  monthlyIncome: number;
  finalYearGross: number;
  finalYearNet: number;
  endValue: number;
  deposits: number;
  dividendsGross: number;
  tax: number;
  dividendsNet: number;
  totalReturnPct: number;
  averageAnnualPct: number;
  years: DividendCalcYear[];
}

export type DividendCalcResult =
  | { ok: true; formulaVersion: string; cash: DividendCalcPlan; drip: DividendCalcPlan }
  | { ok: false; reason: string };

function check(i: DividendCalcInput): string | null {
  const fields: [string, number | undefined][] = [
    ['price', i.price],
    ['shares', i.shares],
    ['years', i.years],
    ['yield', i.yieldPct],
    ['payouts per year', i.payoutsPerYear],
    ['yearly contribution', i.yearlyContribution],
    ['contributions per year', i.contributionsPerYear],
    ['dividend tax', i.taxPct],
    ['dividend growth', i.dividendGrowthPct],
    ['price growth', i.priceGrowthPct],
  ];
  for (const [name, v] of fields) {
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) return `${name} is not a number`;
    if (v < 0) return `${name} is negative`;
  }
  if (i.price <= 0) return 'price must be above zero';
  if (!Number.isInteger(i.years) || i.years < 1 || i.years > 30)
    return 'holding period must be 1 to 30 whole years';
  if (!(PAYOUT_FREQUENCIES as readonly number[]).includes(i.payoutsPerYear))
    return 'payouts per year must be 1, 2, 4 or 12';
  if (
    i.contributionsPerYear !== undefined &&
    !(PAYOUT_FREQUENCIES as readonly number[]).includes(i.contributionsPerYear)
  )
    return 'contributions per year must be 1, 2, 4 or 12';
  if ((i.taxPct ?? 0) > 100) return 'dividend tax must be 0 to 100%';
  if (i.yieldPct > 100) return 'yield must be 0 to 100%';
  return null;
}

function plan(i: DividendCalcInput, drip: boolean): DividendCalcPlan {
  const payEvery = 12 / i.payoutsPerYear;
  const cpy = i.contributionsPerYear ?? 12;
  const contribEvery = 12 / cpy;
  const contribution = (i.yearlyContribution ?? 0) / cpy;
  const tax = (i.taxPct ?? 0) / 100;
  const g = (i.dividendGrowthPct ?? 0) / 100;
  const pg = (i.priceGrowthPct ?? 0) / 100;
  const priceAt = (m: number) => i.price * (1 + pg) ** (m / 12);
  const dps1 = i.price * (i.yieldPct / 100);

  let shares = i.shares;
  let deposits = i.price * i.shares;
  let gross = 0;
  let net = 0;
  const years: DividendCalcYear[] = [];
  for (let y = 1; y <= i.years; y += 1) {
    const dps = dps1 * (1 + g) ** (y - 1);
    const start = shares;
    let yGross = 0;
    let yNet = 0;
    let yContrib = 0;
    for (let k = 1; k <= 12; k += 1) {
      const m = (y - 1) * 12 + k;
      const p = priceAt(m);
      if (k % payEvery === 0) {
        const pay = (shares * dps) / i.payoutsPerYear;
        const after = pay * (1 - tax);
        yGross += pay;
        yNet += after;
        if (drip) shares += after / p;
      }
      if (contribution > 0 && k % contribEvery === 0) {
        shares += contribution / p;
        yContrib += contribution;
      }
    }
    gross += yGross;
    net += yNet;
    deposits += yContrib;
    const priceEnd = priceAt(y * 12);
    years.push({
      year: y,
      sharesStart: start,
      dividendPerShare: dps,
      dividendsGross: yGross,
      dividendsNet: yNet,
      payouts: i.payoutsPerYear,
      contributions: yContrib,
      sharesEnd: shares,
      priceEnd,
      valueEnd: shares * priceEnd,
    });
  }
  const last = years.at(-1) as DividendCalcYear;
  const endValue = last.valueEnd;
  const kept = drip ? 0 : net;
  const ratio = deposits > 0 ? (endValue + kept) / deposits : 1;
  return {
    monthlyIncome: last.dividendsNet / 12,
    finalYearGross: last.dividendsGross,
    finalYearNet: last.dividendsNet,
    endValue,
    deposits,
    dividendsGross: gross,
    tax: gross - net,
    dividendsNet: net,
    totalReturnPct: deposits > 0 ? (ratio - 1) * 100 : 0,
    averageAnnualPct: deposits > 0 ? (ratio ** (1 / i.years) - 1) * 100 : 0,
    years,
  };
}

export function dividendCalc(input: DividendCalcInput): DividendCalcResult {
  const why = check(input);
  if (why) return { ok: false, reason: why };
  return {
    ok: true,
    formulaVersion: DIVIDEND_CALC_VERSION,
    cash: plan(input, false),
    drip: plan(input, true),
  };
}

/** The year-by-year table as CSV text (comma-separated, header first, numbers unrounded to 6 places). */
export function dividendCalcCsv(p: DividendCalcPlan): string {
  const head = [
    'year',
    'shares_start',
    'dividend_per_share',
    'dividends_gross',
    'dividends_net',
    'payouts',
    'contributions',
    'shares_end',
    'price_end',
    'value_end',
  ];
  const f = (v: number) => (Math.round(v * 1e6) / 1e6).toString();
  return [
    head.join(','),
    ...p.years.map((y) =>
      [
        y.year,
        f(y.sharesStart),
        f(y.dividendPerShare),
        f(y.dividendsGross),
        f(y.dividendsNet),
        y.payouts,
        f(y.contributions),
        f(y.sharesEnd),
        f(y.priceEnd),
        f(y.valueEnd),
      ].join(','),
    ),
  ].join('\n');
}
