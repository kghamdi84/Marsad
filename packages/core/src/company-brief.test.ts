import { describe, expect, it } from 'vitest';
import business from '../../../fixtures/massive/sections-NVDA-business.json';
import type { FinancialFact } from './adapters/sec-facts.js';
import {
  BRIEF_RULES,
  COMPANY_BRIEF_VERSION,
  companyBrief,
  firstBusinessSentence,
  periodReturn,
  type CompanyBriefInput,
} from './company-brief.js';
import type { DailyBar } from './study.js';

// A made-up company (ACME), every figure chosen so the answers can be checked by hand. Tolerance: 1e-9 on ratios
// unless stated (toBeCloseTo with 9 digits), exact on sums.

const fact = (
  concept: string,
  start: string | null,
  end: string,
  value: number,
  filed: string,
  unit = 'USD',
  taxonomy = 'us-gaap',
): FinancialFact => ({
  taxonomy,
  concept,
  unit,
  start,
  end,
  value,
  accession: `0000000000-${filed.slice(2, 4)}-${filed.slice(5, 7)}${filed.slice(8, 10)}00`,
  form: '10-Q',
  fy: Number(end.slice(0, 4)),
  fp: 'Q',
  filed,
  frame: null,
});

// [start, end, filed]: each quarter is filed about five weeks after it ends.
const QUARTERS: [string, string, string][] = [
  ['2024-01-01', '2024-03-31', '2024-05-06'],
  ['2024-04-01', '2024-06-30', '2024-08-05'],
  ['2024-07-01', '2024-09-30', '2024-11-04'],
  ['2024-10-01', '2024-12-31', '2025-02-10'],
  ['2025-01-01', '2025-03-31', '2025-05-05'],
  ['2025-04-01', '2025-06-30', '2025-08-04'],
  ['2025-07-01', '2025-09-30', '2025-11-03'],
  ['2025-10-01', '2025-12-31', '2026-02-09'],
];
const LAST4 = QUARTERS.slice(4);

const FACTS: FinancialFact[] = [
  // Revenue 10, 11, ..., 17 billion; net income 2 billion every quarter.
  ...QUARTERS.map(([s, e, f], i) => fact('Revenues', s, e, (10 + i) * 1e9, f)),
  ...QUARTERS.map(([s, e, f]) => fact('NetIncomeLoss', s, e, 2e9, f)),
  // Operating cash flow 3 billion and capital spending 1 billion in each of the last four quarters.
  ...LAST4.map(([s, e, f]) => fact('NetCashProvidedByUsedInOperatingActivities', s, e, 3e9, f)),
  ...LAST4.map(([s, e, f]) => fact('PaymentsToAcquirePropertyPlantAndEquipment', s, e, 1e9, f)),
  // Diluted weighted shares: 1.000 billion a year earlier, 1.031 billion now (+3.1%).
  fact(
    'WeightedAverageNumberOfDilutedSharesOutstanding',
    '2024-10-01',
    '2024-12-31',
    1.0e9,
    '2025-02-10',
    'shares',
  ),
  fact(
    'WeightedAverageNumberOfDilutedSharesOutstanding',
    '2025-10-01',
    '2025-12-31',
    1.031e9,
    '2026-02-09',
    'shares',
  ),
  // Balance at 2025-12-31: cash 5 billion, long-term debt 2 billion (net cash 3 billion).
  fact('CashAndCashEquivalentsAtCarryingValue', null, '2025-12-31', 5e9, '2026-02-09'),
  fact('LongTermDebt', null, '2025-12-31', 2e9, '2026-02-09'),
  // 1 billion shares on the cover page.
  fact(
    'EntityCommonStockSharesOutstanding',
    null,
    '2026-01-31',
    1e9,
    '2026-02-09',
    'shares',
    'dei',
  ),
];

/** 260 weekday sessions ending Friday 2026-02-27; session i closes at `close(i)`. */
function series(close: (i: number) => number): DailyBar[] {
  const dates: string[] = [];
  const d = new Date('2026-02-27T00:00:00Z');
  while (dates.length < 260) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) dates.unshift(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return dates.map((date, i) => {
    const c = close(i);
    return { date, open: c, high: c, low: c, close: c, volume: 1_000_000, vwap: null };
  });
}

// The company rises from 24.1 to 50.0 (0.1 a session); SPY from 100.0 to 125.9; the sector fund falls 200.0 to 174.1.
const BARS = series((i) => Math.round((24.1 + 0.1 * i) * 10) / 10);
const SPY = series((i) => Math.round((100 + 0.1 * i) * 10) / 10);
const XLK = series((i) => Math.round((200 - 0.1 * i) * 10) / 10);

const insider = (
  date: string,
  code: string,
  ad: 'A' | 'D',
  valueUsd: number | null,
  more: Partial<{ isAmendment: boolean; table: 'non-derivative' | 'derivative' }> = {},
) => ({
  date,
  code,
  acquiredDisposed: ad,
  valueUsd,
  isAmendment: more.isAmendment ?? false,
  table: more.table ?? ('non-derivative' as const),
});

const label = (l: string, ticker = 'ACME') => [{ ticker, label: l }];

const INPUT: CompanyBriefInput = {
  ticker: 'ACME',
  asOf: '2026-03-02',
  name: 'ACME CORP',
  business: {
    text: 'PART I\nItem 1. Business.\nOverview\nThis report contains forward-looking statements. They may be wrong.\nAcme makes widgets for homes and offices. It sells them worldwide.',
    filingDate: '2026-02-20',
    periodEnd: '2025-12-31',
    filingUrl: 'https://www.sec.gov/Archives/edgar/data/1/x.htm',
  },
  bars: BARS,
  spy: SPY,
  sector: { ticker: 'XLK', bars: XLK },
  facts: FACTS,
  strength: { date: '2026-02-27', percentile: 85, rank: 4, members: 21 },
  filings: [
    {
      accession: 'a',
      form: '4',
      filingDate: '2026-02-20',
      items: [],
      primaryDocument: null,
    },
    {
      accession: 'b',
      form: '8-K',
      filingDate: '2026-02-10',
      items: ['2.02', '9.01'],
      primaryDocument: 'x.htm',
    },
    { accession: 'c', form: '10-Q', filingDate: '2025-11-03', items: [], primaryDocument: null },
  ],
  news: [
    { id: 'n1', publishedAt: '2026-03-01T15:00:00Z', sentiment: label('positive') },
    { id: 'n2', publishedAt: '2026-02-20T15:00:00Z', sentiment: label('negative') },
    { id: 'n3', publishedAt: '2026-02-10T15:00:00Z', sentiment: label('neutral') },
    // A duplicate, a story labelled for another ticker only, and one older than 30 days.
    { id: 'n1', publishedAt: '2026-03-01T15:00:00Z', sentiment: label('positive') },
    { id: 'n4', publishedAt: '2026-02-05T15:00:00Z', sentiment: label('positive', 'OTHER') },
    { id: 'n5', publishedAt: '2026-01-15T15:00:00Z', sentiment: label('positive') },
  ],
  insiders: [
    insider('2026-02-10', 'S', 'D', 1_000_000),
    insider('2026-01-15', 'S', 'D', 500_000),
    // Left out: older than 90 days, an option exercise, an amendment, a derivative line.
    insider('2025-11-01', 'S', 'D', 9_000_000),
    insider('2026-02-11', 'M', 'A', 7_000_000),
    insider('2026-02-12', 'S', 'D', 8_000_000, { isAmendment: true }),
    insider('2026-02-13', 'S', 'D', 6_000_000, { table: 'derivative' }),
  ],
  shortInterest: [
    { date: '2026-01-30', shortInterest: 100e6, daysToCover: 2.5 },
    { date: '2026-02-13', shortInterest: 120e6, daysToCover: 3 },
  ],
  dividends: [
    { exDividendDate: '2025-12-05', cashAmount: 0.25, currency: 'USD' },
    { exDividendDate: '2026-03-05', cashAmount: 0.25, currency: 'USD' },
  ],
  earnings: {
    date: '2026-03-10',
    from: '2026-03-03',
    to: '2026-03-17',
    basis: 'same-quarter-last-year',
    lastRelease: '2026-02-10',
    overdue: false,
  },
  regime: {
    date: '2026-02-27',
    label: 'bull-calm',
    ruleVersion: 'regime-1',
    recessionVersion: 'recession-1',
    recessionLevel: 'watch',
    triggered: 1,
    available: 4,
  },
  riskFactors: {
    filingDate: '2025-11-03',
    noMaterialChanges: false,
    filingUrl: 'https://www.sec.gov/q.htm',
  },
  halts: [
    { haltedAt: '2026-02-20T15:00:00Z', reason: 'LUDP' },
    { haltedAt: '2025-12-01T15:00:00Z', reason: 'LUDP' },
  ],
  alerts: [],
};

describe('firstBusinessSentence: the first sentence of the 10-K business section, as filed', () => {
  it('reads the real NVIDIA 10-K Item 1 (fixture recorded 2026-11-24)', () => {
    const text = (business.body.results[0] as { text: string }).text;
    expect(firstBusinessSentence(text)).toBe(
      'NVIDIA pioneered accelerated computing to help solve the most challenging computational problems.',
    );
  });

  it('skips headings, the Item 1 line and the forward-looking notice', () => {
    expect(firstBusinessSentence(INPUT.business?.text ?? '')).toBe(
      'Acme makes widgets for homes and offices.',
    );
  });

  it('returns null rather than a fragment', () => {
    expect(firstBusinessSentence('Item 1. Business\nOverview\nWe sell. Things.')).toBeNull();
    expect(firstBusinessSentence('')).toBeNull();
  });
});

describe('periodReturn: the stock, SPY and the sector fund over the same two sessions', () => {
  it('compares closes 21 sessions apart, by date', () => {
    const r = periodReturn(BARS, 21, SPY, XLK);
    // Session 259 against session 238: 50.0 / 47.9, SPY 125.9 / 123.8, the fund 174.1 / 176.2.
    expect(r?.from).toBe('2026-01-29');
    expect(r?.to).toBe('2026-02-27');
    expect(r?.stock).toBeCloseTo(50 / 47.9 - 1, 9);
    expect(r?.spy).toBeCloseTo(125.9 / 123.8 - 1, 9);
    expect(r?.sector).toBeCloseTo(174.1 / 176.2 - 1, 9);
  });

  it('gives null without enough history, and null for a benchmark missing either date', () => {
    expect(periodReturn(BARS.slice(-21), 21, SPY, null)).toBeNull();
    const r = periodReturn(BARS, 21, SPY.slice(-10), null);
    expect(r?.spy).toBeNull();
    expect(r?.sector).toBeNull();
  });
});

describe('companyBrief, hand-checked (company-brief-1)', () => {
  const b = companyBrief(INPUT);

  it('company: name, what it does with its filing date, market value with its dates', () => {
    expect(b.formulaVersion).toBe(COMPANY_BRIEF_VERSION);
    expect(b.versions).toEqual({
      snapshot: 'snapshot-1',
      investor: 'investor-1',
      trader: 'trader-1',
      strength: 'strength-1',
    });
    expect(b.company.name).toBe('ACME CORP');
    expect(b.company.whatItDoes).toEqual({
      sentence: 'Acme makes widgets for homes and offices.',
      filingDate: '2026-02-20',
      periodEnd: '2025-12-31',
      filingUrl: 'https://www.sec.gov/Archives/edgar/data/1/x.htm',
    });
    // The 50.00 close of 2026-02-27 x 1 billion shares on the 2026-01-31 cover page.
    expect(b.company.marketValue).toEqual({
      value: 50e9,
      close: 50,
      priceDate: '2026-02-27',
      shares: 1e9,
      sharesDate: '2026-01-31',
    });
  });

  it('performance: returns beside SPY and the fund, revenue, margin, free cash flow and dilution', () => {
    const p = b.performance;
    expect(p.close).toEqual({ value: 50, date: '2026-02-27' });
    // 63 sessions: 50.0 / 43.7; a year (252): 50.0 / 24.8.
    expect(p.returns.m3?.stock).toBeCloseTo(50 / 43.7 - 1, 9);
    expect(p.returns.m3?.spy).toBeCloseTo(125.9 / 119.6 - 1, 9);
    expect(p.returns.y1?.stock).toBeCloseTo(50 / 24.8 - 1, 9);
    expect(p.returns.y1?.sector).toBeCloseTo(174.1 / 199.3 - 1, 9);
    expect(p.sectorTicker).toBe('XLK');
    // 14 + 15 + 16 + 17 = 62 billion to 2025-12-31, against 10 + 11 + 12 + 13 = 46 billion: +34.7826%.
    expect(p.revenue?.value).toBe(62e9);
    expect(p.revenue?.end).toBe('2025-12-31');
    expect(p.revenue?.yoyPct).toBeCloseTo((62 / 46 - 1) * 100, 9);
    // 4 x 2 = 8 billion over 62 billion.
    expect(p.netMargin?.pct).toBeCloseTo((8 / 62) * 100, 9);
    // 4 x 3 - 4 x 1 = 8 billion, the newest part filed 2026-02-09.
    expect(p.freeCashFlow).toEqual({ value: 8e9, filed: '2026-02-09' });
    // 1.031 / 1.000 - 1 = +3.1%, the quarter to 2025-12-31.
    expect(p.dilution?.pct).toBeCloseTo(3.1, 9);
    expect(p.dilution?.end).toBe('2025-12-31');
  });

  it('checks: only rules whose inputs exist fire, each with its value, threshold and date', () => {
    const ids = b.checks.map((c) => `${c.side}:${c.id}`);
    // Net margin 12.9% sits between the loss and 15% rules, so neither fires; the close is at its 52-week high.
    expect(ids).toEqual([
      'strength:revenue-growth',
      'strength:net-cash',
      'strength:fcf-positive',
      'risk:dilution',
      'strength:above-200',
      'strength:beats-spy',
      'strength:strength-top',
      'risk:short-interest',
      'risk:insider-selling',
      'risk:earnings-soon',
      'risk:recent-halt',
    ]);
    const by = (id: string) => b.checks.find((c) => c.id === id);
    expect(by('revenue-growth')).toMatchObject({ threshold: 10, date: '2025-12-31' });
    expect(by('net-cash')).toEqual({
      id: 'net-cash',
      side: 'strength',
      value: 3e9,
      threshold: null,
      date: '2025-12-31',
    });
    expect(by('dilution')).toMatchObject({ threshold: 2, date: '2025-12-31' });
    // The 200-day average of sessions 60 to 259: 24.1 + 0.1 x 159.5 = 40.05.
    expect(by('above-200')?.value).toBe(50);
    expect(by('above-200')?.extra).toBeCloseTo(40.05, 9);
    // trader-1 relative strength over 63 sessions: (50 / 43.7) / (125.9 / 119.6) - 1 = +8.69%.
    expect(by('beats-spy')?.value).toBeCloseTo((50 / 43.7 / (125.9 / 119.6) - 1) * 100, 9);
    expect(by('strength-top')).toMatchObject({ value: 85, threshold: 80, extra: 21 });
    // 120 million short over 1 billion shares outstanding = 12%, settled 2026-02-13.
    expect(by('short-interest')).toMatchObject({ value: 12, threshold: 10, date: '2026-02-13' });
    // Two open-market sales in 90 days, 1,000,000 + 500,000; no purchases.
    expect(by('insider-selling')).toMatchObject({ value: 1_500_000, extra: 2, date: '2026-03-02' });
    // 2026-03-02 to the estimated 2026-03-10: 8 days.
    expect(by('earnings-soon')).toMatchObject({ value: 8, threshold: 14, date: '2026-03-10' });
    expect(by('recent-halt')).toMatchObject({ value: 1, date: '2026-02-20' });
  });

  it('sentiment: stored labels counted once in 30 days, no percentage below 30 stories', () => {
    expect(b.sentiment.news).toEqual({
      days: 30,
      stories: 4,
      positive: 1,
      neutral: 1,
      negative: 1,
      unlabelled: 1,
      stored: true,
      capped: false,
      pct: null,
    });
    expect(b.sentiment.insiders).toEqual({
      days: 90,
      buys: 0,
      sells: 2,
      buyUsd: 0,
      sellUsd: 1_500_000,
      netUsd: -1_500_000,
      unpriced: 0,
    });
    // 120 / 100 - 1 = +20% since the previous settlement.
    expect(b.sentiment.short?.pctOfShares).toBeCloseTo(12, 9);
    expect(b.sentiment.short?.prior?.date).toBe('2026-01-30');
    expect(b.sentiment.short?.prior?.shares).toBe(100e6);
    expect(b.sentiment.short?.prior?.changePct).toBeCloseTo(20, 9);
  });

  it('context: the regime, the fund against SPY and the recession filter, with dates', () => {
    expect(b.context.regime).toEqual({
      label: 'bull-calm',
      date: '2026-02-27',
      ruleVersion: 'regime-1',
    });
    expect(b.context.sector?.ticker).toBe('XLK');
    expect(b.context.sector?.date).toBe('2026-02-27');
    expect(b.context.sector?.rs1m).toBeCloseTo(174.1 / 176.2 / (125.9 / 123.8) - 1, 9);
    expect(b.context.sector?.rs3m).toBeCloseTo(174.1 / 180.4 / (125.9 / 119.6) - 1, 9);
    expect(b.context.recession).toEqual({
      level: 'watch',
      triggered: 1,
      available: 4,
      date: '2026-02-27',
      version: 'recession-1',
    });
  });

  it("what's next: the newest 8-K, 10-Q or 10-K, risk factor changes, earnings, ex-dividend, halts", () => {
    expect(b.next.latestReport?.accession).toBe('b');
    expect(b.next.riskFactors).toEqual({
      filingDate: '2025-11-03',
      changed: true,
      filingUrl: 'https://www.sec.gov/q.htm',
    });
    expect(b.next.earnings?.daysAway).toBe(8);
    expect(b.next.exDividend).toEqual({ date: '2026-03-05', cashAmount: 0.25, currency: 'USD' });
    expect(b.next.halts?.count).toBe(1);
    expect(b.next.alerts).toEqual({ count: 0, newest: null, days: 30 });
  });

  it('gives a percentage once 30 stories are labelled', () => {
    const news = Array.from({ length: 30 }, (_, i) => ({
      id: `s${i}`,
      publishedAt: '2026-03-01T12:00:00Z',
      sentiment: label(i < 12 ? 'neutral' : i < 22 ? 'positive' : 'negative'),
    }));
    const s = companyBrief({ ...INPUT, news }).sentiment.news;
    // 10, 12 and 8 of 30.
    expect(s?.pct?.positive).toBeCloseTo((10 / 30) * 100, 9);
    expect(s?.pct?.neutral).toBeCloseTo(40, 9);
    expect(s?.pct?.negative).toBeCloseTo((8 / 30) * 100, 9);
    expect(BRIEF_RULES.minStories).toBe(30);
  });

  it('says the sentiment is not stored when no story carries a label', () => {
    const news = [{ id: 'x', publishedAt: '2026-03-01T12:00:00Z', sentiment: [] }];
    expect(companyBrief({ ...INPUT, news }).sentiment.news?.stored).toBe(false);
  });

  it('insider buying outranks selling, and losses, net debt and lagging SPY are risks', () => {
    const facts = FACTS.map((f) =>
      f.concept === 'NetIncomeLoss'
        ? { ...f, value: -1e9 }
        : f.concept === 'LongTermDebt'
          ? { ...f, value: 9e9 }
          : f,
    );
    const b2 = companyBrief({
      ...INPUT,
      facts,
      // SPY 59.2 to 71.8 over 63 sessions: (50 / 43.7) / (71.8 / 59.2) - 1 = -5.66%.
      spy: series((i) => Math.round((20 + 0.2 * i) * 10) / 10),
      insiders: [...(INPUT.insiders ?? []), insider('2026-02-25', 'P', 'A', 250_000)],
    });
    const ids = b2.checks.map((c) => c.id);
    expect(ids).toContain('net-loss');
    expect(ids).toContain('net-debt');
    expect(ids).toContain('lags-spy');
    expect(ids).toContain('insider-buying');
    expect(ids).not.toContain('insider-selling');
    expect(b2.checks.find((c) => c.id === 'net-debt')?.value).toBe(5e9 - 9e9);
    expect(b2.sentiment.insiders?.netUsd).toBe(250_000 - 1_500_000);
  });

  it('missing inputs give null, never a guess, and no check fires', () => {
    const empty = companyBrief({
      ticker: 'NONE',
      asOf: '2026-03-02',
      name: null,
      business: null,
      bars: [],
      spy: null,
      sector: null,
      facts: null,
      strength: null,
      filings: null,
      news: null,
      insiders: null,
      shortInterest: null,
      dividends: null,
      earnings: null,
      regime: null,
      riskFactors: null,
      halts: null,
      alerts: null,
    });
    expect(empty.checks).toEqual([]);
    expect(empty.company).toEqual({ name: null, whatItDoes: null, marketValue: null });
    expect(empty.performance.returns).toEqual({ m1: null, m3: null, y1: null });
    expect(empty.performance.revenue).toBeNull();
    expect(empty.sentiment).toEqual({ news: null, insiders: null, short: null });
    expect(empty.context).toEqual({ regime: null, sector: null, recession: null });
    expect(empty.next).toEqual({
      latestReport: null,
      riskFactors: null,
      earnings: null,
      exDividend: null,
      halts: null,
      alerts: null,
    });
  });
});
