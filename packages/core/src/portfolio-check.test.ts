import { describe, expect, it } from 'vitest';
import type { JournalTrade } from './journal.js';
import type { Holding } from './portfolio.js';
import {
  CHECK_RULES,
  DIVIDEND_WITHHOLDING,
  LIMITS_SET_ON,
  limitBreaches,
  resolveLimits,
  DISTRIBUTION_BUCKETS,
  exitReview,
  forwardIncome,
  rPerformance,
  weekdaysBetween,
  type ReviewRow,
  PORTFOLIO_CHECK_VERSION,
  PORTFOLIO_LIMITS,
  annualizedPayment,
  betaBucket,
  bookPositions,
  checkNarrative,
  closedTradeSummary,
  comingUp,
  dayMoves,
  currentMix,
  distribution,
  dividendYield,
  marketCapBucket,
  mergeDividends,
  mixRisk,
  monthlyReturns,
  needsAttention,
  peBucket,
  periodReturns,
  portfolioCheck,
  portfolioDividends,
  portfolioPe,
  priceVsAverages,
  recentActivity,
  trailingDividends,
  tradeReturn,
  weeklyMoves,
  ytdSessions,
  type BookLot,
  type MixSeries,
  type PayoutRow,
} from './portfolio-check.js';
import type { DailyBar } from './study.js';

// Every figure below is small enough to check by hand. Tolerance: 9 decimal places on ratios (toBeCloseTo with 9
// digits); sums and counts are exact.

const bar = (date: string, close: number): DailyBar => ({
  date,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
  vwap: null,
});
const series = (dates: readonly string[], closes: readonly number[]) =>
  dates.map((d, i) => bar(d, closes[i] as number));
const D = ['2026-11-20', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27'];

const lot = (x: Partial<BookLot> & { ticker: string }): BookLot => ({
  shares: 1,
  costBasis: 1,
  price: 1,
  priceDate: '2026-11-27',
  beta: null,
  sector: null,
  ...x,
});

// The three-position book used by the check and the cards: A 60 at 5 (now 10), B 30 at 20 (now 10), C 100 at 2
// (now 1). Value 600 + 300 + 100 = 1,000; cost 300 + 600 + 200 = 1,100.
const BOOK: BookLot[] = [
  lot({ ticker: 'A', shares: 60, costBasis: 5, price: 10, beta: 1.5, sector: 'Technology' }),
  lot({ ticker: 'B', shares: 30, costBasis: 20, price: 10, beta: null, sector: null }),
  lot({ ticker: 'C', shares: 100, costBasis: 2, price: 1, beta: 0.5, sector: 'Technology' }),
];

describe('limits and bucket edges (one constant each)', () => {
  it('states the limits the page shows', () => {
    expect(PORTFOLIO_CHECK_VERSION).toBe('portfolio-check-1');
    // Set by the council at Khaled's request (ADR 0048, round 2).
    expect(PORTFOLIO_LIMITS).toEqual({
      largestPosition: 0.2,
      top5: 0.6,
      minCash: 0.1,
      portfolioBeta: 1.5,
      openRisk: 0.06,
    });
    expect(LIMITS_SET_ON).toBe('2026-11-28');
    expect(Object.isFrozen(PORTFOLIO_LIMITS)).toBe(true);
    expect(CHECK_RULES).toEqual({
      sector: 0.4,
      volatility: 0.35,
      drawdown: 0.25,
      belowCostShare: 0.5,
      downFromCost: 0.4,
      lossShare: 0.25,
      highBeta: 2,
      bookLoss: 0.25,
      weeklyMove: 0.05,
      comingUpDays: 56,
      sizerRisk: 0.01,
      sizerCap: 0.25,
    });
    expect(Object.isFrozen(CHECK_RULES)).toBe(true);
  });

  it('keeps every bucket list ascending and open-ended', () => {
    for (const edges of Object.values(DISTRIBUTION_BUCKETS)) {
      const b = edges.map((e) => e.below);
      expect([...b].sort((x, y) => x - y)).toEqual(b);
      expect(b.at(-1)).toBe(Infinity);
    }
    expect(DISTRIBUTION_BUCKETS.marketCap.map((e) => e.below)).toEqual([
      300e6,
      2e9,
      10e9,
      200e9,
      Infinity,
    ]);
  });

  it('puts a value on an edge in the upper bucket and labels missing values', () => {
    expect(marketCapBucket(299e6)).toBe('micro');
    expect(marketCapBucket(300e6)).toBe('small');
    expect(marketCapBucket(250e9)).toBe('mega');
    expect(marketCapBucket(null)).toBe('unavailable');
    expect(marketCapBucket(0)).toBe('unavailable');
    expect(betaBucket(-0.3)).toBe('low');
    expect(betaBucket(0.8)).toBe('market');
    expect(betaBucket(2)).toBe('very-high');
    expect(betaBucket(null)).toBe('unavailable');
    expect(peBucket(-5)).toBe('not-meaningful');
    expect(peBucket(0)).toBe('not-meaningful');
    expect(peBucket(14.99)).toBe('under-15');
    expect(peBucket(15)).toBe('15-25');
    expect(peBucket(40)).toBe('over-40');
    expect(peBucket(null)).toBe('not-meaningful');
  });
});

describe('bookPositions', () => {
  it('combines lots by ticker, averages cost by shares and lists unpriced tickers', () => {
    const b = bookPositions([
      lot({ ticker: 'A', shares: 10, costBasis: 100, price: 120 }),
      lot({ ticker: 'A', shares: 10, costBasis: 80, price: 120 }),
      lot({ ticker: 'B', shares: 5, costBasis: 50, price: null }),
    ]);
    expect(b.unpriced).toEqual(['B']);
    expect(b.positions).toHaveLength(1);
    const a = b.positions[0];
    expect(a?.shares).toBe(20);
    expect(a?.costBasis).toBe(90);
    expect(a?.value).toBe(2400);
    expect(a?.usd).toBe(600);
    expect(a?.pct).toBeCloseTo(1 / 3, 9);
    expect(a?.weight).toBe(1);
  });
});

describe('holdings-table formulas', () => {
  it('counts YTD sessions from the last close of the previous year', () => {
    const b = series(['2025-12-30', '2025-12-31', '2026-01-02', '2026-01-05'], [1, 2, 3, 4]);
    expect(ytdSessions(b)).toBe(2);
    expect(ytdSessions(series(['2026-01-02', '2026-01-05'], [1, 2]))).toBeNull();
  });

  it('gives each period return or null where the bars do not reach', () => {
    const b = series(D, [100, 101, 102, 103, 104, 110]);
    const spy = series(D, [50, 50, 50, 50, 50, 55]);
    const r = periodReturns(b, spy);
    expect(r.w1?.stock).toBeCloseTo(0.1, 9);
    expect(r.w1?.spy).toBeCloseTo(0.1, 9);
    expect(r.w1?.from).toBe('2026-11-20');
    expect(r.m1).toBeNull();
    expect(r.y1).toBeNull();
    expect(r.ytd).toBeNull();
  });

  it('compares the close with its 50- and 200-day averages', () => {
    const closes = Array.from({ length: 200 }, (_x, i) => i + 1);
    const p = priceVsAverages(closes);
    // SMA 50 of 151..200 is 175.5; SMA 200 of 1..200 is 100.5; only gains, so RSI 14 is 100.
    expect(p.sma50).toBeCloseTo(175.5, 9);
    expect(p.vs50).toBeCloseTo(200 / 175.5 - 1, 9);
    expect(p.sma200).toBeCloseTo(100.5, 9);
    expect(p.vs200).toBeCloseTo(200 / 100.5 - 1, 9);
    expect(p.rsi14).toBe(100);
    const short = priceVsAverages([1, 2, 3]);
    expect(short.vs50).toBeNull();
    expect(short.rsi14).toBeNull();
  });
});

describe('dividends', () => {
  const pay = (exDate: string, amount: number, frequency: number | null = 4): PayoutRow => ({
    ticker: 'KO',
    exDate,
    payDate: null,
    amount,
    frequency,
    source: 'massive',
  });
  const rows = [
    pay('2025-11-27', 0.24),
    pay('2026-02-10', 0.25),
    pay('2026-05-10', 0.25),
    pay('2026-08-10', 0.25),
    pay('2026-11-10', 0.26),
    pay('2026-12-10', 0.26),
  ];

  it('sums the 365 days ending on the last close; the day 365 days back is outside', () => {
    const t = trailingDividends(rows, '2026-11-27');
    expect(t.from).toBe('2025-11-27');
    expect(t.payments).toBe(4);
    expect(t.perShare).toBeCloseTo(1.01, 9);
    expect(t.latest?.exDate).toBe('2026-11-10');
    expect(t.next?.exDate).toBe('2026-12-10');
    expect(dividendYield(t.perShare, 50.5)).toBeCloseTo(0.02, 9);
    expect(dividendYield(1, null)).toBeNull();
    expect(dividendYield(1, 0)).toBeNull();
  });

  it('annualizes one payment only with a stated frequency', () => {
    expect(annualizedPayment(0.26, 4)).toBeCloseTo(1.04, 9);
    expect(annualizedPayment(0.26, 0)).toBeNull();
    expect(annualizedPayment(0.26, null)).toBeNull();
  });

  it('merges Tauric calendar rows without duplicating a stored Massive row', () => {
    const m = mergeDividends(
      [pay('2026-11-10', 0.26)],
      [
        { ticker: 'KO', exDate: '2026-11-10', amount: 0.26 },
        { ticker: 'KO', exDate: '2027-02-10', amount: 0.27 },
        { ticker: 'PEP', exDate: null, amount: 1 },
        { ticker: 'PEP', exDate: '2027-01-01', amount: null },
      ],
    );
    expect(m.map((r) => [r.exDate, r.source])).toEqual([
      ['2026-11-10', 'massive'],
      ['2027-02-10', 'tauric'],
    ]);
  });

  it('adds up the book income and the yield on value', () => {
    const d = portfolioDividends([
      { ticker: 'KO', shares: 100, price: 50, ttmPerShare: 1 },
      { ticker: 'NVDA', shares: 10, price: 100, ttmPerShare: 0 },
    ]);
    expect(d.income).toBe(100);
    expect(d.value).toBe(6000);
    expect(d.yieldOnValue).toBeCloseTo(100 / 6000, 9);
    expect(d.payers).toEqual([{ ticker: 'KO', income: 100, yield: 0.02, value: 5000 }]);
    expect(d.nonPayers).toEqual(['NVDA']);
  });
});

describe('current holdings at today’s weights against SPY', () => {
  const dates = ['2026-11-25', '2026-11-26', '2026-11-27'];
  const bars = {
    SPY: series(dates, [100, 110, 99]),
    A: series(dates, [10, 11, 12]),
    B: series(dates, [20, 20, 30]),
    C: series(dates.slice(1), [5, 6]),
  };

  it('values today’s shares at past closes and leaves out a ticker with a gap', () => {
    const m = currentMix(
      [
        { ticker: 'A', shares: 10 },
        { ticker: 'B', shares: 5 },
        { ticker: 'C', shares: 1 },
      ],
      bars,
      5,
    ) as MixSeries;
    // 200, 210, 270: 0, +5%, +35%. SPY 0, +10%, -1%. Asked for 5 sessions, 2 are stored.
    expect(m.sessions).toBe(2);
    expect(m.from).toBe('2026-11-25');
    expect(m.included).toEqual(['A', 'B']);
    expect(m.leftOut).toEqual(['C']);
    expect(m.points.map((p) => p.portfolio)).toEqual([
      0,
      expect.closeTo(0.05, 9),
      expect.closeTo(0.35, 9),
    ]);
    expect(m.points.map((p) => p.spy)).toEqual([
      0,
      expect.closeTo(0.1, 9),
      expect.closeTo(-0.01, 9),
    ]);
    expect(currentMix([{ ticker: 'C', shares: 1 }], bars, 5)).toBeNull();
    expect(currentMix([{ ticker: 'A', shares: 1 }], { A: bars.A }, 5)).toBeNull();
  });

  it('measures the mix: volatility needs 60 returns; the largest fall compounds', () => {
    const mk = (ps: number[]): MixSeries => ({
      version: PORTFOLIO_CHECK_VERSION,
      sessions: ps.length - 1,
      from: '2026-01-01',
      to: '2026-01-03',
      included: ['A'],
      leftOut: [],
      points: ps.map((p, i) => ({ date: `2026-01-0${i + 1}`, portfolio: p, spy: 0 })),
    });
    const r = mixRisk(mk([0, 0.1, -0.12]));
    // Returns +10% then 0.88 / 1.10 - 1 = -20%: the fall from the peak is -20%.
    expect(r.returns).toBe(2);
    expect(r.maxDrawdown).toBeCloseTo(-0.2, 9);
    expect(r.volatility).toBeNull();
    // 61 points alternating +1% and -1% daily returns: sample deviation times sqrt(252).
    const ps = [0];
    for (let i = 1; i <= 60; i++) ps.push((1 + (ps[i - 1] as number)) * (i % 2 ? 1.01 : 0.99) - 1);
    const v = mixRisk(mk(ps)).volatility as number;
    const sd = Math.sqrt((60 * 0.01 * 0.01) / 59);
    expect(v).toBeCloseTo(sd * Math.sqrt(252), 9);
  });

  it('splits the mix into calendar months, first and newest marked partial', () => {
    const m: MixSeries = {
      version: PORTFOLIO_CHECK_VERSION,
      sessions: 4,
      from: '2026-09-29',
      to: '2026-11-03',
      included: ['A'],
      leftOut: [],
      points: [
        { date: '2026-09-29', portfolio: 0, spy: 0 },
        { date: '2026-09-30', portfolio: 0.1, spy: 0.02 },
        { date: '2026-10-15', portfolio: 0.21, spy: 0.03 },
        { date: '2026-10-30', portfolio: 0.155, spy: 0.0404 },
        { date: '2026-11-03', portfolio: 0.2705, spy: 0.0404 },
      ],
    };
    const r = monthlyReturns(m);
    expect(r.map((x) => [x.month, x.partial])).toEqual([
      ['2026-09', true],
      ['2026-10', false],
      ['2026-11', true],
    ]);
    expect(r[0]?.portfolio).toBeCloseTo(0.1, 9);
    expect(r[1]?.portfolio).toBeCloseTo(0.05, 9);
    expect(r[1]?.spy).toBeCloseTo(1.0404 / 1.02 - 1, 9);
    expect(r[1]?.from).toBe('2026-09-30');
    expect(r[2]?.portfolio).toBeCloseTo(0.1, 9);
    expect(r[2]?.spy).toBeCloseTo(0, 9);
  });
});

describe('portfolioCheck', () => {
  const council = resolveLimits({ role: 'owner' });
  const c = portfolioCheck({
    lots: BOOK,
    mix: null,
    cash: null,
    limits: council.limits,
    openRisk: { pct: 0.08, unknown: ['B'] },
  });

  it('measures concentration, sectors, beta and the open result', () => {
    expect(c.count).toBe(3);
    expect(c.value).toBe(1000);
    expect(c.cost).toBe(1100);
    expect(c.equity).toBe(1000);
    expect(c.concentration.largest).toEqual({ ticker: 'A', weight: 0.6 });
    expect(c.concentration.top3).toBeCloseTo(1, 9);
    expect(c.concentration.top5).toBeCloseTo(1, 9);
    // 0.6^2 + 0.3^2 + 0.1^2 = 0.46.
    expect(c.concentration.hhi).toBeCloseTo(0.46, 9);
    expect(c.sectors.map((s) => [s.sector, s.tickers])).toEqual([
      ['Technology', ['A', 'C']],
      ['Unclassified', ['B']],
    ]);
    expect(c.sectors[0]?.weight).toBeCloseTo(0.7, 9);
    // (600 x 1.5 + 300 x 1 (assumed) + 100 x 0.5) / 1,000 = 1.25.
    expect(c.risk.beta).toBeCloseTo(1.25, 9);
    expect(c.risk.betaAssumed).toEqual(['B']);
    expect(c.risk.openRisk).toEqual({ pct: 0.08, unknown: ['B'] });
    expect(c.performance.usd).toBe(-100);
    expect(c.performance.pct).toBeCloseTo(-1 / 11, 9);
    expect(c.performance.belowCost).toBe(2);
    expect(c.performance.rows.map((r) => r.ticker)).toEqual(['A', 'C', 'B']);
    expect(c.cash).toBeNull();
  });

  it('states each measure against the limit or rule, unavailable when it cannot be computed', () => {
    expect(council.source).toBe('council');
    expect(c.rows.map((r) => [r.id, r.kind, r.state])).toEqual([
      ['largest', 'limit', 'above'],
      ['top5', 'limit', 'above'],
      ['beta', 'limit', 'within'],
      ['cash', 'limit', 'unavailable'],
      ['open-risk', 'limit', 'above'],
      ['sector', 'rule', 'above'],
      ['volatility', 'rule', 'unavailable'],
      ['drawdown', 'rule', 'unavailable'],
      ['below-cost', 'rule', 'above'],
    ]);
    expect(c.rows[0]?.subject).toBe('A');
    expect(c.rows[5]?.subject).toBe('Technology');
    expect(limitBreaches(c).map((r) => r.id)).toEqual(['largest', 'top5', 'open-risk']);
    const one = portfolioCheck({
      lots: [lot({ ticker: 'A', price: 10, costBasis: 10 })],
      mix: null,
      cash: null,
      limits: council.limits,
    });
    // Exactly at a rule is within; open risk without a review is unavailable.
    expect(one.rows.find((r) => r.id === 'below-cost')?.state).toBe('within');
    expect(one.rows.find((r) => r.id === 'largest')?.state).toBe('above');
    expect(one.rows.find((r) => r.id === 'open-risk')?.state).toBe('unavailable');
  });

  it('measures shares of equity with tracked cash, and cash as a minimum', () => {
    const rich = portfolioCheck({ lots: BOOK, mix: null, cash: 1000, limits: council.limits });
    // Equity 2,000: A is 30% of it, cash 50% (at least 10%: within).
    expect(rich.equity).toBe(2000);
    expect(rich.concentration.largest?.weight).toBeCloseTo(0.3, 9);
    expect(rich.rows.find((r) => r.id === 'cash')).toMatchObject({
      value: 0.5,
      minimum: true,
      state: 'within',
    });
    const thin = portfolioCheck({ lots: BOOK, mix: null, cash: 50, limits: council.limits });
    // 50 of 1,050 is 4.8%: under the 10% minimum.
    expect(thin.rows.find((r) => r.id === 'cash')?.state).toBe('above');
    expect(thin.rows.find((r) => r.id === 'cash')?.value).toBeCloseTo(50 / 1050, 9);
  });

  it('gives a member no limits, and lets stored limits replace the council values', () => {
    const member = resolveLimits({ role: 'member' });
    expect(member.source).toBe('none');
    expect(Object.values(member.limits).every((v) => v === null)).toBe(true);
    const m = portfolioCheck({ lots: BOOK, mix: null, cash: null, limits: member.limits });
    expect(m.rows.filter((r) => r.kind === 'limit').map((r) => r.state)).toEqual([
      'unset',
      'unset',
      'unset',
      'unset',
      'unset',
    ]);
    expect(checkNarrative(m)).toContain('No limits are set.');
    const own = resolveLimits({ role: 'owner', user: { top5: 0.9, minCash: null } });
    expect(own.source).toBe('user');
    expect(own.limits).toEqual({
      largestPosition: 0.2,
      top5: 0.9,
      minCash: null,
      portfolioBeta: 1.5,
      openRisk: 0.06,
    });
  });

  it('writes the narrative from the numbers, with no instruction words', () => {
    const text = checkNarrative(c);
    expect(text).toBe(
      'The book holds 3 priced positions worth $1,000 at the close of 2026-11-27. The largest position, A, is 60.0% of equity; the top five are 100.0%. The largest sector group is Technology at 70.0%. Value-weighted beta to SPY is 1.25. The open result is −$100 (−9.1%) on cost; 2 of 3 positions are below cost. Cash is not tracked. Past your limits: largest position 60.0% (limit 20.0%); top 5 positions 100.0% (limit 60.0%); open risk 8.0% (limit 6.0%). Past Marsad’s check rules: largest sector, positions below cost.',
    );
    expect(text).not.toMatch(/\b(buy|sell|hold|trim|add|cut|consider|should|worth holding)\b/i);
    expect(text).not.toMatch(new RegExp(String.fromCharCode(0x2014)));
    expect(
      checkNarrative(portfolioCheck({ lots: [], mix: null, cash: null, limits: council.limits })),
    ).toBe('No priced holdings: there is nothing to check yet.');
  });
});

describe('needsAttention', () => {
  const book = bookPositions(BOOK.map((l) => (l.ticker === 'A' ? { ...l, beta: 2.5 } : l)));
  const cards = needsAttention(book.positions);
  const by = (id: string) => cards.find((x) => x.id === id);

  it('returns every rule, with its numbers and whether it fired', () => {
    expect(cards.map((x) => [x.id, x.state, x.met])).toEqual([
      ['down-from-cost', 'above', true],
      ['loss-share', 'above', true],
      ['high-beta', 'note', true],
      ['book-loss', 'above', false],
      ['biggest-gainer', 'positive', true],
    ]);
    // B and C are each 50% below cost: -300 and -100.
    expect(by('down-from-cost')?.tickers).toEqual(['B', 'C']);
    expect(by('down-from-cost')?.usd).toBe(-400);
    expect(by('down-from-cost')?.value).toBeCloseTo(-0.5, 9);
    // B holds 300 of the 400 total loss (75%); C holds 25%, not more than 25%.
    expect(by('loss-share')?.tickers).toEqual(['B']);
    expect(by('loss-share')?.value).toBeCloseTo(0.75, 9);
    expect(by('high-beta')?.value).toBe(1);
    expect(by('high-beta')?.weight).toBeCloseTo(0.6, 9);
    expect(by('high-beta')?.usd).toBe(600);
    // Book result -100 on 1,100 cost is -9.1%: not below -25%.
    expect(by('book-loss')?.value).toBeCloseTo(-1 / 11, 9);
    expect(by('biggest-gainer')?.tickers).toEqual(['A']);
    expect(by('biggest-gainer')?.usd).toBe(300);
  });

  it('fires the whole-book rule below minus 25% of cost', () => {
    const b = bookPositions([lot({ ticker: 'X', shares: 10, costBasis: 10, price: 7 })]);
    const k = needsAttention(b.positions);
    expect(k.find((x) => x.id === 'book-loss')?.met).toBe(true);
    expect(k.find((x) => x.id === 'book-loss')?.usd).toBe(-30);
    expect(k.find((x) => x.id === 'biggest-gainer')?.met).toBe(false);
  });
});

describe('distribution and P/E', () => {
  it('weights and counts each slice with its holdings by value', () => {
    const d = distribution([
      { ticker: 'A', value: 600, key: 'tech' },
      { ticker: 'B', value: 300, key: 'other' },
      { ticker: 'C', value: 100, key: 'tech' },
    ]);
    expect(d).toEqual([
      { key: 'tech', value: 700, weight: 0.7, count: 2, tickers: ['A', 'C'] },
      { key: 'other', value: 300, weight: 0.3, count: 1, tickers: ['B'] },
    ]);
  });

  it('takes the value-weighted harmonic mean of positive P/Es only', () => {
    const p = portfolioPe([
      { ticker: 'A', value: 600, pe: 20 },
      { ticker: 'B', value: 300, pe: 30 },
      { ticker: 'C', value: 100, pe: -5 },
      { ticker: 'D', value: 100, pe: null },
    ]);
    // 900 / (600 / 20 + 300 / 30) = 900 / 40 = 22.5; the arithmetic mean (23.3) would be wrong.
    expect(p.pe).toBeCloseTo(22.5, 9);
    expect(p.included.map((r) => r.ticker)).toEqual(['B', 'A']);
    expect(p.notMeaningful).toEqual(['C', 'D']);
    expect(p.coverage).toBeCloseTo(900 / 1100, 9);
    expect(portfolioPe([{ ticker: 'C', value: 1, pe: -1 }]).pe).toBeNull();
  });
});

const trade = (x: Partial<JournalTrade> & { id: number }): JournalTrade => ({
  ticker: 'X',
  side: 'long',
  setup: '',
  tags: [],
  alertId: null,
  entryDate: '2026-10-01',
  entryPrice: 100,
  shares: 10,
  stop: null,
  target: null,
  exitDate: null,
  exitPrice: null,
  checklist: {},
  checklistVersion: 'checklist-2',
  followed: {},
  notes: '',
  screenshots: [],
  ...x,
});

describe('closed trades', () => {
  it('returns on entry, flipped for a short', () => {
    expect(tradeReturn(trade({ id: 1, exitDate: '2026-10-02', exitPrice: 110 }))).toBeCloseTo(
      0.1,
      9,
    );
    expect(
      tradeReturn(trade({ id: 2, side: 'short', exitDate: '2026-10-02', exitPrice: 90 })),
    ).toBeCloseTo(0.1, 9);
    expect(tradeReturn(trade({ id: 3 }))).toBeNull();
  });

  it('gives counts and no percentage below 30 closed trades', () => {
    const ts = Array.from({ length: 16 }, (_x, i) =>
      trade({ id: i, exitDate: '2026-10-05', exitPrice: i < 4 ? 120 : 90 }),
    );
    ts.push(trade({ id: 99 }));
    const s = closedTradeSummary(ts);
    expect(s).toEqual({
      closed: 16,
      profitable: 4,
      winRate: null,
      meanReturn: null,
      insufficient: true,
    });
  });

  it('gives the win rate and mean return from 30 closed trades', () => {
    const ts = Array.from({ length: 30 }, (_x, i) =>
      trade({ id: i, exitDate: '2026-10-05', exitPrice: i < 12 ? 120 : 90 }),
    );
    const s = closedTradeSummary(ts);
    expect(s.closed).toBe(30);
    expect(s.profitable).toBe(12);
    expect(s.winRate).toBeCloseTo(0.4, 9);
    // (12 x 0.2 + 18 x -0.1) / 30 = 0.02.
    expect(s.meanReturn).toBeCloseTo(0.02, 9);
    expect(s.insufficient).toBe(false);
  });
});

describe('recentActivity', () => {
  it('labels Opened, Added and Closed from the record, newest first', () => {
    const rows = recentActivity(
      [
        trade({ id: 1, entryDate: '2026-10-01', exitDate: '2026-10-10', exitPrice: 110 }),
        trade({ id: 2, entryDate: '2026-10-05', entryPrice: 104 }),
      ],
      [
        { ticker: 'X', openedOn: '2026-10-05' },
        { ticker: 'Y', openedOn: '2026-11-01' },
      ],
    );
    expect(rows).toEqual([
      {
        ticker: 'Y',
        transactions: 1,
        lastAction: 'opened',
        lastDate: '2026-11-01',
        lastClosedReturn: null,
        realizedUsd: 0,
      },
      {
        ticker: 'X',
        transactions: 3,
        lastAction: 'closed',
        lastDate: '2026-10-10',
        lastClosedReturn: expect.closeTo(0.1, 9),
        realizedUsd: 100,
      },
    ]);
    const added = recentActivity(
      [trade({ id: 1, entryDate: '2026-10-01' }), trade({ id: 2, entryDate: '2026-10-03' })],
      [],
    );
    expect(added[0]?.lastAction).toBe('added');
  });
});

describe('weeklyMoves', () => {
  it('lists moves above 5% over five sessions, largest first', () => {
    const m = weeklyMoves(['A', 'B', 'C', 'Z'], {
      A: series(D, [100, 1, 1, 1, 1, 106]),
      B: series(D, [100, 1, 1, 1, 1, 104]),
      C: series(D, [100, 1, 1, 1, 1, 93]),
      Z: series(D.slice(1), [1, 1, 1, 1, 9]),
    });
    expect(m.map((x) => x.ticker)).toEqual(['C', 'A']);
    expect(m[0]?.change).toBeCloseTo(-0.07, 9);
    expect(m[0]?.from).toBe('2026-11-20');
    expect(m[1]?.change).toBeCloseTo(0.06, 9);
  });
});

describe('comingUp', () => {
  it('keeps the next 56 days, prefers a stated earnings date and counts undated catalysts', () => {
    const r = comingUp({
      today: '2026-11-28',
      earnings: [
        { ticker: 'A', date: '2026-12-10', eps: 1.2, source: 'tauric-calendar' },
        { ticker: 'A', date: '2026-12-12', eps: null, source: 'marsad-estimate' },
        { ticker: 'B', date: '2027-01-20', eps: null, source: 'marsad-estimate' },
        { ticker: 'C', date: '2027-02-01', eps: 0.5, source: 'tauric-calendar' },
      ],
      dividends: [
        {
          ticker: 'A',
          exDate: '2026-12-01',
          payDate: null,
          amount: 0.25,
          frequency: 4,
          source: 'massive',
        },
        {
          ticker: 'B',
          exDate: '2026-11-27',
          payDate: null,
          amount: 0.1,
          frequency: 4,
          source: 'massive',
        },
      ],
      catalysts: [
        { ticker: 'A', date: '2026-12-10', text: 'Product event', timing: 'upcoming' },
        { ticker: 'A', date: null, text: 'Someday', timing: null },
      ],
    });
    expect(r.to).toBe('2027-01-23');
    expect(r.events.map((e) => [e.date, e.ticker, e.kind, e.estimated])).toEqual([
      ['2026-12-01', 'A', 'ex-dividend', false],
      ['2026-12-10', 'A', 'earnings', false],
      ['2026-12-10', 'A', 'catalyst', false],
      ['2027-01-20', 'B', 'earnings', true],
    ]);
    expect(r.events[1]?.amount).toBe(1.2);
    expect(r.undatedCatalysts).toBe(1);
  });
});

describe('dayMoves', () => {
  it('adds each holding’s last-session change and ranks up to three each way', () => {
    const two = (a: number, b: number) => series(['2026-11-26', '2026-11-27'], [a, b]);
    const m = dayMoves(
      [
        { ticker: 'A', shares: 10 },
        { ticker: 'A', shares: 10 },
        { ticker: 'B', shares: 5 },
        { ticker: 'C', shares: 1 },
        { ticker: 'D', shares: 1 },
        { ticker: 'E', shares: 1 },
        { ticker: 'F', shares: 1 },
        { ticker: 'G', shares: 1 },
      ],
      {
        A: two(10, 11),
        B: two(20, 18),
        C: two(100, 103),
        D: two(100, 102),
        E: two(100, 101),
        F: two(100, 99),
        G: series(['2026-11-27'], [5]),
      },
    );
    // A: 20 x +1 = +20; B: 5 x -2 = -10; C +3, D +2, E +1, F -1. Total +15 on 200 + 100 + 400 = 700.
    expect(m.usd).toBe(15);
    expect(m.pct).toBeCloseTo(15 / 700, 9);
    expect(m.gainers).toEqual(['A', 'C', 'D']);
    expect(m.losers).toEqual(['B', 'F']);
    expect(m.missing).toEqual(['G']);
    expect(m.rows.find((r) => r.ticker === 'A')?.change).toBeCloseTo(0.1, 9);
  });
});

describe('exitReview', () => {
  // 16 sessions, high and low one dollar either side of the close: every true range is 2, so ATR 14 is 2.
  const dates16 = Array.from(
    { length: 16 },
    (_x, i) => `2026-11-${String(i + 1).padStart(2, '0')}`,
  );
  const flat = (close: number) =>
    dates16.map((d) => ({ ...bar(d, close), high: close + 1, low: close - 1 }));
  const h = (x: Partial<Holding & { id: number }> & { id: number; ticker: string }) => ({
    shares: 10,
    costBasis: 20,
    openedOn: '2026-11-10',
    stop: null,
    targets: [],
    trendBreak: null,
    timeStopSessions: null,
    ...x,
  });
  const r = exitReview({
    lots: [
      h({ id: 1, ticker: 'A', stop: 18 }),
      h({ id: 2, ticker: 'B', shares: 5 }),
      h({ id: 3, ticker: 'C', stop: 25 }),
    ],
    bars: { A: flat(20), B: flat(40), C: flat(20) },
    earnings: { A: { date: '2026-12-03', estimated: true } },
  });

  it('puts lots without exit rules first, then conditions met, then dollars at risk', () => {
    expect(r.rows.map((x) => x.ticker)).toEqual(['B', 'C', 'A']);
    expect(r.rows[0]?.hasRules).toBe(false);
    expect(r.rows[1]?.signals.map((s) => s.kind)).toEqual(['stop']);
  });

  it('measures the stop distance, risk, size and what the sizer allows', () => {
    const a = r.rows.find((x) => x.ticker === 'A') as ReviewRow;
    // Equity 200 + 200 + 200 = 600 (cash not tracked).
    expect(r.equity).toBe(600);
    expect(a.stopGap).toBeCloseTo(20 / 18 - 1, 9);
    expect(a.atr).toBeCloseTo(2, 9);
    expect(a.stopAtrs).toBeCloseTo(1, 9);
    expect(a.riskUsd).toBe(20);
    // 200 over the 25% cap of 600 (150).
    expect(a.sizeVsCap).toBeCloseTo(200 / 150, 9);
    // Bars after 10 Nov: 11 to 16 Nov.
    expect(a.sessions).toBe(6);
    expect(a.nextEarnings).toEqual({ date: '2026-12-03', estimated: true });
    // 1% of 600 is 6 over a 2.00 stop distance: 3 shares; the cap allows 7.
    expect(a.sizer).toEqual({ shares: 3, capped: false });
    const c = r.rows.find((x) => x.ticker === 'C') as ReviewRow;
    // Closed under the stop: nothing left to lose to it, and the sizer cannot size a stop above the close.
    expect(c.riskUsd).toBe(0);
    expect(c.stopGap).toBeCloseTo(20 / 25 - 1, 9);
    expect(c.sizer).toEqual({ error: 'For a long trade the stop must be below the entry.' });
    expect(r.rows.find((x) => x.ticker === 'B')?.riskUsd).toBeNull();
  });

  it('adds up the open risk as a share of equity and names lots without a stop', () => {
    expect(r.openRisk).toBe(20);
    expect(r.openRiskPct).toBeCloseTo(20 / 600, 9);
    expect(r.noStop).toEqual(['B']);
  });
});

describe('rPerformance', () => {
  it('counts weekdays held, holidays not removed', () => {
    // Fri 2026-11-20 to Mon 2026-11-23: one weekday (Monday).
    expect(weekdaysBetween('2026-11-20', '2026-11-23')).toBe(1);
    expect(weekdaysBetween('2026-11-23', '2026-11-27')).toBe(4);
    expect(weekdaysBetween('2026-11-23', '2026-11-23')).toBe(0);
  });

  it('gives counts and no means below 30 closed trades', () => {
    const ts = [
      trade({ id: 1, stop: 90, exitDate: '2026-10-02', exitPrice: 120 }),
      trade({ id: 2, stop: 90, exitDate: '2026-10-02', exitPrice: 95 }),
      trade({ id: 3, stop: 90, exitDate: '2026-10-02', exitPrice: 100 }),
      trade({ id: 4 }),
    ];
    const r = rPerformance(ts);
    expect(r).toMatchObject({
      closed: 3,
      winners: 1,
      losers: 1,
      flat: 1,
      withR: 3,
      insufficient: true,
      expectancyR: null,
      avgWinR: null,
      avgLossR: null,
      winnerDays: null,
      loserDays: null,
    });
    expect(r.adherence.insufficient).toBe(true);
  });

  it('gives expectancy, mean win and loss in R and days held from 30 closed trades', () => {
    // 10 winners: entry 100, stop 90, exit 120 (+2R), Thu 1 Oct to Tue 6 Oct (3 weekdays).
    // 20 losers: exit 95 (-0.5R), Thu 1 Oct to Fri 2 Oct (1 weekday).
    const ts = [
      ...Array.from({ length: 10 }, (_x, i) =>
        trade({ id: i, stop: 90, exitDate: '2026-10-06', exitPrice: 120 }),
      ),
      ...Array.from({ length: 20 }, (_x, i) =>
        trade({ id: 100 + i, stop: 90, exitDate: '2026-10-02', exitPrice: 95 }),
      ),
    ];
    const r = rPerformance(ts);
    expect(r.insufficient).toBe(false);
    // (10 x 2 + 20 x -0.5) / 30 = 1/3 R.
    expect(r.expectancyR).toBeCloseTo(1 / 3, 9);
    expect(r.avgWinR).toBeCloseTo(2, 9);
    expect(r.avgLossR).toBeCloseTo(-0.5, 9);
    expect(r.winnerDays).toBe(3);
    expect(r.loserDays).toBe(1);
  });
});

describe('forwardIncome', () => {
  const pay = (
    ticker: string,
    exDate: string,
    amount: number,
    frequency: number | null,
  ): PayoutRow => ({ ticker, exDate, payDate: null, amount, frequency, source: 'massive' });

  it('annualizes the newest payment, falls back to the trailing year, nets 30% withholding', () => {
    expect(DIVIDEND_WITHHOLDING).toBe(0.3);
    const r = forwardIncome(
      [
        {
          ticker: 'KO',
          shares: 100,
          price: 50,
          costBasis: 40,
          payouts: [pay('KO', '2026-08-10', 0.25, 4), pay('KO', '2026-12-10', 0.26, 4)],
        },
        {
          ticker: 'XYZ',
          shares: 10,
          price: 20,
          costBasis: 25,
          payouts: [pay('XYZ', '2026-03-01', 0.5, 0), pay('XYZ', '2026-09-01', 0.5, null)],
        },
        { ticker: 'NVDA', shares: 1, price: 100, costBasis: 100, payouts: [] },
      ],
      '2026-11-27',
    );
    // KO: 0.26 x 4 = 1.04 a share, 104 gross, 72.80 net; yield on cost 1.04 / 40 = 2.6%.
    const ko = r.rows[0];
    expect(ko?.ticker).toBe('KO');
    expect(ko?.basis).toBe('stated-frequency');
    expect(ko?.perShare).toBeCloseTo(1.04, 9);
    expect(ko?.gross).toBeCloseTo(104, 9);
    expect(ko?.net).toBeCloseTo(72.8, 9);
    expect(ko?.yieldOnCost).toBeCloseTo(0.026, 9);
    expect(ko?.from?.exDate).toBe('2026-12-10');
    // XYZ: no stated frequency on the newest row, so the trailing year: 1.00 a share, 10 gross.
    const xyz = r.rows.find((x) => x.ticker === 'XYZ');
    expect(xyz?.basis).toBe('trailing-12m');
    expect(xyz?.gross).toBeCloseTo(10, 9);
    expect(r.rows.find((x) => x.ticker === 'NVDA')?.basis).toBe('none');
    // Totals: 114 gross, 79.80 net; cost 4,000 + 250 + 100; value 5,000 + 200 + 100.
    expect(r.gross).toBeCloseTo(114, 9);
    expect(r.net).toBeCloseTo(79.8, 9);
    expect(r.yieldOnCost).toBeCloseTo(114 / 4350, 9);
    expect(r.yieldOnValue).toBeCloseTo(114 / 5300, 9);
  });
});
