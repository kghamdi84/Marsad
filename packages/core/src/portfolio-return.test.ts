import { describe, expect, it } from 'vitest';
import {
  MAX_MISSING_SHARE,
  PORTFOLIO_RETURN_VERSION,
  portfolioReturn,
  tradeFlows,
  xirr,
  type CashFlow,
  type PortfolioTrade,
} from './portfolio-return.js';
import type { DailyBar } from './study.js';

const bar = (date: string, close: number): DailyBar => ({
  date,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
  vwap: null,
});
const series = (dates: readonly string[], closes: readonly (number | null)[]) =>
  dates.flatMap((d, i) => (closes[i] === null ? [] : [bar(d, closes[i] as number)]));

let nextId = 1;
const trade = (
  t: Partial<PortfolioTrade> &
    Pick<PortfolioTrade, 'ticker' | 'entryDate' | 'entryPrice' | 'shares'>,
): PortfolioTrade => ({
  id: nextId++,
  side: 'long',
  exitDate: null,
  exitPrice: null,
  ...t,
});

const near = (v: number | null | undefined, want: number, tol = 1e-9) =>
  expect(Math.abs((v ?? NaN) - want)).toBeLessThan(tol);

/** The NPV of flows at a rate, actual/365, as a spreadsheet column would compute it by hand. */
const npv = (flows: readonly CashFlow[], r: number) => {
  const d0 = Date.parse(`${flows[0]!.date}T00:00:00Z`);
  return flows.reduce(
    (s, f) =>
      s + f.amount / (1 + r) ** ((Date.parse(`${f.date}T00:00:00Z`) - d0) / 86_400_000 / 365),
    0,
  );
};

describe('xirr (portfolio-return-1)', () => {
  // The worked example in the spreadsheet XIRR documentation: 0.373362535 (37.34%).
  const example: CashFlow[] = [
    { date: '2008-01-01', amount: -10_000 },
    { date: '2008-03-01', amount: 2_750 },
    { date: '2008-10-30', amount: 4_250 },
    { date: '2009-02-15', amount: 3_250 },
    { date: '2009-04-01', amount: 2_750 },
  ];

  it('matches the spreadsheet example within 1e-6', () => {
    const r = xirr(example);
    expect(r?.method).toBe('newton');
    near(r?.rate, 0.373362535, 1e-6);
    // Hand check: the flows discounted at the rate sum to zero.
    expect(Math.abs(npv(example, r!.rate))).toBeLessThan(1e-6);
  });

  it('two flows: the closed form (1100 / 1000)^(365 / 366) - 1 over a leap year', () => {
    const r = xirr([
      { date: '2024-01-01', amount: -1_000 },
      { date: '2025-01-01', amount: 1_100 },
    ]);
    near(r?.rate, 1.1 ** (365 / 366) - 1, 1e-10);
  });

  it('falls back to bisection when Newton does not converge, with the same root', () => {
    const r = xirr(example, { newtonIterations: 0 });
    expect(r?.method).toBe('bisection');
    near(r?.rate, 0.373362535, 1e-6);
  });

  it('null without a sign change or with every flow on one day', () => {
    expect(xirr([{ date: '2025-01-01', amount: -100 }])).toBeNull();
    expect(
      xirr([
        { date: '2025-01-01', amount: 100 },
        { date: '2025-02-01', amount: 100 },
      ]),
    ).toBeNull();
    expect(
      xirr([
        { date: '2025-01-01', amount: -100 },
        { date: '2025-01-01', amount: 110 },
      ]),
    ).toBeNull();
  });
});

describe('portfolioReturn (portfolio-return-1)', () => {
  it('single buy and hold, with a fee: TWR 600 / 505 - 1, XIRR and SPY by hand', () => {
    const dates = ['2024-01-02', '2024-06-03', '2025-01-02'];
    const r = portfolioReturn({
      trades: [
        trade({ ticker: 'AAA', entryDate: dates[0]!, entryPrice: 50, shares: 10, entryFee: 5 }),
      ],
      closes: { AAA: series(dates, [52, 55, 60]) },
      spy: series(dates, [400, 420, 440]),
    });
    expect(r.formulaVersion).toBe(PORTFOLIO_RETURN_VERSION);
    expect(r.period).toEqual({ from: dates[0], to: dates[2], sessions: 3, calendarDays: 366 });
    expect(r.trades).toBe(1);
    expect(r.closedTrades).toBe(0);
    expect(r.cashFlows).toBe(1);
    near(r.deposits, 505);
    near(r.fees, 5);
    near(r.endValue, 600);
    near(r.twr, 600 / 505 - 1);
    // Day 1: 520 / 505 - 1 (the buy day counts from the trade price and fee, not the close).
    near(r.days[0]!.return, 520 / 505 - 1);
    near(r.twrAnnualized, (600 / 505) ** (365 / 366) - 1);
    near(r.moneyWeighted, (600 / 505) ** (365 / 366) - 1, 1e-9);
    // SPY: 505 buys 505 / 400 shares, worth 505 * 440 / 400 at the end.
    near(r.spy?.endValue, (505 * 440) / 400, 1e-9);
    near(r.spy?.twr, 0.1);
    near(r.spy?.moneyWeighted, 1.1 ** (365 / 366) - 1, 1e-9);
    expect(r.spy?.negativeBalance).toBe(false);
    expect(r.missingDays).toBe(0);
  });

  it('buy, add and partial sell, fills off the close and fees: TWR checked by hand', () => {
    // Closes 100, 105, 110, 100, 120, 125. Buy 10 at 100 on day 0. Add 10 at 108 (fee 2) on day 2. Sell those 10 at
    // 118 (fee 3) on day 4. Values at the close: 1000, 1050, 2200, 2000, 1200, 1250.
    // Day 1: 1050 / 1000.
    // Day 2: to the trade 1080 / 1050 (10 held, at the fill); after it 2200 / (1080 + 1082).
    // Day 3: 2000 / 2200.
    // Day 4: to the trade (2360 - 3) / 2000 (20 held at the fill, less the sell fee); after it
    //        1200 / (2357 - 1177).
    // Day 5: 1250 / 1200.
    // Product: 1.08 * 2357 * 1250 / (2162 * 1180).
    const dates = [
      '2025-03-03',
      '2025-03-04',
      '2025-03-05',
      '2025-03-06',
      '2025-03-07',
      '2025-03-10',
    ];
    const r = portfolioReturn({
      trades: [
        trade({ ticker: 'AAA', entryDate: dates[0]!, entryPrice: 100, shares: 10 }),
        trade({
          ticker: 'AAA',
          entryDate: dates[2]!,
          entryPrice: 108,
          shares: 10,
          entryFee: 2,
          exitDate: dates[4]!,
          exitPrice: 118,
          exitFee: 3,
        }),
      ],
      closes: { AAA: series(dates, [100, 105, 110, 100, 120, 125]) },
      spy: series(dates, [100, 101, 102, 103, 104, 105]),
    });
    expect(r.trades).toBe(2);
    expect(r.closedTrades).toBe(1);
    expect(r.cashFlows).toBe(3);
    near(r.deposits, 2_082);
    near(r.withdrawals, 1_177);
    near(r.fees, 5);
    near(r.endValue, 1_250);
    expect(r.days.map((d) => d.value)).toEqual([1000, 1050, 2200, 2000, 1200, 1250]);
    near(r.days[2]!.return, (1080 / 1050) * (2200 / 2162) - 1);
    near(r.days[4]!.return, (2357 / 2000) * (1200 / 1180) - 1);
    near(r.twr, (1.08 * 2357 * 1250) / (2162 * 1180) - 1);
    // Without fees the TWR of one ticker is its price change, 125 / 100 - 1; the fees cost a little.
    expect(r.twr!).toBeLessThan(0.25);
    expect(r.twrAnnualized).toBeNull(); // under a year: not annualized
    // SPY with the same dollars: 1000 / 100 + 1082 / 102 - 1177 / 104 shares, worth 105 each at the end.
    near(r.spy?.endValue, (1000 / 100 + 1082 / 102 - 1177 / 104) * 105, 1e-9);
    near(r.spy?.twr, 105 / 100 - 1);
    // Money-weighted: the flows plus the end value discount to zero at the rate.
    const flows: CashFlow[] = [
      { date: dates[0]!, amount: -1000 },
      { date: dates[2]!, amount: -1082 },
      { date: dates[4]!, amount: 1177 },
      { date: dates[5]!, amount: 1250 },
    ];
    expect(Math.abs(npv(flows, r.moneyWeighted!))).toBeLessThan(1e-6);
  });

  it('two tickers: the untraded one is valued at the close up to the trade (hand-checked)', () => {
    // Day 0: buy 10 A and 10 B at 10. Day 1: A closes 12, B 11; add 10 A at 11.
    // To the trade: (10 * 11 + 10 * 11) / 200 = 1.1. After it: (20 * 12 + 10 * 11) / (220 + 110) = 350 / 330.
    const dates = ['2025-03-03', '2025-03-04'];
    const r = portfolioReturn({
      trades: [
        trade({ ticker: 'A', entryDate: dates[0]!, entryPrice: 10, shares: 10 }),
        trade({ ticker: 'B', entryDate: dates[0]!, entryPrice: 10, shares: 10 }),
        trade({ ticker: 'A', entryDate: dates[1]!, entryPrice: 11, shares: 10 }),
      ],
      closes: { A: series(dates, [10, 12]), B: series(dates, [10, 11]) },
      spy: series(dates, [1, 1]),
    });
    near(r.days[0]!.return, 0);
    near(r.twr, (1.1 * 350) / 330 - 1);
  });

  it('TWR does not depend on the size of a deposit; the money-weighted rate does', () => {
    // One ticker, the add filled at 104 against a close of 105: the TWR is the price change 120 / 100 - 1 for an
    // add of 10 shares or of 1,000.
    const dates = ['2025-03-03', '2025-03-04', '2025-03-05', '2025-03-06'];
    const closes = { AAA: series(dates, [100, 110, 105, 120]) };
    const spy = series(dates, [100, 100, 100, 100]);
    const run = (add: number) =>
      portfolioReturn({
        trades: [
          trade({ ticker: 'AAA', entryDate: dates[0]!, entryPrice: 100, shares: 10 }),
          trade({ ticker: 'AAA', entryDate: dates[2]!, entryPrice: 104, shares: add }),
        ],
        closes,
        spy,
      });
    const small = run(10);
    const large = run(1_000);
    near(small.twr, 0.2);
    near(large.twr, 0.2);
    near(small.twr, large.twr!, 1e-12);
    expect(Math.abs(small.moneyWeighted! - large.moneyWeighted!)).toBeGreaterThan(0.01);
  });

  it('a missing close is carried and flagged; at 5% or less the TWR stands', () => {
    // 25 sessions, AAA missing on one (4%): that day is valued at the previous close.
    const dates = Array.from({ length: 25 }, (_, i) => `2025-01-${String(i + 1).padStart(2, '0')}`);
    const closes = dates.map((_, i) => (i === 10 ? null : 100 + i));
    const r = portfolioReturn({
      trades: [trade({ ticker: 'AAA', entryDate: dates[0]!, entryPrice: 100, shares: 1 })],
      closes: { AAA: series(dates, closes) },
      spy: series(
        dates,
        dates.map(() => 500),
      ),
    });
    expect(r.missingDays).toBe(1);
    expect(r.missingCloses).toEqual([{ ticker: 'AAA', date: dates[10] }]);
    expect(r.days[10]!.carried).toEqual(['AAA']);
    near(r.days[10]!.value, 109);
    near(r.twr, 124 / 100 - 1);
    expect(r.twrUnavailable).toBeNull();
  });

  it(`more than ${MAX_MISSING_SHARE * 100}% of sessions missing a close: TWR null with the reason`, () => {
    const dates = Array.from({ length: 25 }, (_, i) => `2025-01-${String(i + 1).padStart(2, '0')}`);
    const closes = dates.map((_, i) => (i === 10 || i === 11 ? null : 100 + i));
    const r = portfolioReturn({
      trades: [trade({ ticker: 'AAA', entryDate: dates[0]!, entryPrice: 100, shares: 1 })],
      closes: { AAA: series(dates, closes) },
      spy: series(
        dates,
        dates.map(() => 500),
      ),
    });
    expect(r.missingDays).toBe(2);
    expect(r.twr).toBeNull();
    expect(r.twrUnavailable).toBe('2 of 25 sessions lack a close for a holding (more than 5%)');
    expect(r.moneyWeighted).not.toBeNull();
  });

  it('point in time: trades after asOf are left out and an exit after asOf is still open', () => {
    const dates = ['2025-03-03', '2025-03-04', '2025-03-05'];
    const r = portfolioReturn({
      trades: [
        trade({
          ticker: 'AAA',
          entryDate: dates[0]!,
          entryPrice: 10,
          shares: 10,
          exitDate: dates[2]!,
          exitPrice: 20,
        }),
        trade({ ticker: 'BBB', entryDate: dates[2]!, entryPrice: 10, shares: 10 }),
      ],
      closes: { AAA: series(dates, [10, 12, 20]), BBB: series(dates, [10, 10, 10]) },
      spy: series(dates, [1, 1, 1]),
      asOf: dates[1]!,
    });
    expect(r.trades).toBe(1);
    expect(r.closedTrades).toBe(0);
    expect(r.period?.to).toBe(dates[1]);
    near(r.endValue, 120);
    near(r.twr, 0.2);
  });

  it('short trades and broken rows are listed, not counted', () => {
    const f = tradeFlows(
      [
        trade({ ticker: 'SHO', side: 'short', entryDate: '2025-01-02', entryPrice: 10, shares: 1 }),
        trade({ ticker: 'BAD', entryDate: '2025-01-02', entryPrice: 0, shares: 1 }),
        trade({
          ticker: 'NOX',
          entryDate: '2025-01-02',
          entryPrice: 5,
          shares: 1,
          exitDate: '2025-01-03',
        }),
        trade({ ticker: 'OK', entryDate: '2025-01-02', entryPrice: 5, shares: 1 }),
      ],
      '2025-12-31',
    );
    expect(f.trades).toBe(1);
    expect(f.excluded.map((e) => [e.ticker, e.reason])).toEqual([
      ['SHO', 'short trades are not included'],
      ['BAD', 'entry price or shares not above zero'],
      ['NOX', 'exit date without a positive exit price'],
    ]);
  });

  it('a trade dated off the stored sessions counts on the next session', () => {
    const dates = ['2025-03-07', '2025-03-10', '2025-03-11']; // Friday, Monday, Tuesday
    const r = portfolioReturn({
      trades: [trade({ ticker: 'AAA', entryDate: '2025-03-08', entryPrice: 10, shares: 1 })],
      closes: { AAA: series(dates, [9, 11, 12]) },
      spy: series(dates, [1, 1, 1]),
    });
    expect(r.flowsOffSession).toBe(1);
    expect(r.period?.from).toBe('2025-03-10');
    near(r.twr, 0.2);
  });

  it('a full exit then a fresh buy links through the days with nothing held', () => {
    // Buy 10 at 100, sell at 110 (+10%); nothing held for a day; buy 5 at 50, worth 55 at the end (+10%).
    const dates = ['2025-03-03', '2025-03-04', '2025-03-05', '2025-03-06', '2025-03-07'];
    const r = portfolioReturn({
      trades: [
        trade({
          ticker: 'AAA',
          entryDate: dates[0]!,
          entryPrice: 100,
          shares: 10,
          exitDate: dates[1]!,
          exitPrice: 110,
        }),
        trade({ ticker: 'BBB', entryDate: dates[3]!, entryPrice: 50, shares: 5 }),
      ],
      closes: {
        AAA: series(dates, [100, 110, 90, 95, 99]),
        BBB: series(dates, [50, 50, 50, 50, 55]),
      },
      spy: series(dates, [10, 10, 10, 10, 10]),
    });
    expect(r.days[2]!.return).toBeNull();
    near(r.twr, 1.1 * 1.1 - 1);
  });

  it('no trades: everything null with the reason', () => {
    const r = portfolioReturn({ trades: [], closes: {}, spy: [bar('2025-01-02', 1)] });
    expect(r.twr).toBeNull();
    expect(r.twrUnavailable).toBe('no long trades in the period');
    expect(r.period).toBeNull();
  });
});
