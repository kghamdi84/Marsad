import { describe, expect, it } from 'vitest';
import nvda from '../../../fixtures/tauric/research-NVDA-2026-11-28.json';
import aapl from '../../../fixtures/tauric/research-AAPL-2026-11-28.json';
import { validateAnalyst, validateCalendar, validateProfile } from './company-research.js';
import type { DailyBar } from './study.js';
import {
  MARKET_FIELDS,
  SUMMARY_FIELDS,
  TICKER_SUMMARY_VERSION,
  sectorFundOf,
  tickerDailySummary,
  type SummaryResearch,
  type TickerSummaryInput,
} from './ticker-summary.js';

/** Consecutive calendar days from 2024-05-01, so 2024-12-31 is bar 244 and 2025-01-15 is bar 259. */
const day = (i: number) =>
  new Date(Date.UTC(2024, 4, 1) + i * 86_400_000).toISOString().slice(0, 10);
/** Close 100 + i, high and low one either side, volume 1,000 + i. */
const bar = (i: number, close = 100 + i): DailyBar => ({
  date: day(i),
  open: close,
  high: close + 1,
  low: close - 1,
  close,
  volume: 1000 + i,
  vwap: null,
});
const line = (n: number) => Array.from({ length: n }, (_, i) => bar(i));
const flatSpy = (n: number) => Array.from({ length: n }, (_, i) => bar(i, 100));

const research = (fx: typeof nvda | typeof aapl, ticker: string): SummaryResearch => {
  const part = <T>(r: { ok: true; value: T } | { ok: false; reason: string }): T => {
    if (!r.ok) throw new Error(r.reason);
    return r.value;
  };
  return {
    analyst: part(validateAnalyst(fx.parts.analyst.body, ticker)),
    profile: part(validateProfile(fx.parts.profile.body, ticker)),
    calendar: part(validateCalendar(fx.parts.calendar.body, ticker)),
    analystRefreshedAt: '2026-11-28T01:46:14Z',
    profileRefreshedAt: '2026-11-28T01:46:14Z',
    calendarRefreshedAt: null,
    errors: {},
  };
};

const input = (over: Partial<TickerSummaryInput> = {}): TickerSummaryInput => ({
  ticker: 'TEST',
  date: day(259),
  coverage: 'tracked',
  bars: line(260),
  spy: flatSpy(260),
  research: null,
  dividends: [],
  earningsEstimate: null,
  ...over,
});

describe('tickerDailySummary, hand-checked on a straight line (ticker-summary-1)', () => {
  // 260 bars, close 100 + i, so the last close is 359 on 2025-01-15.
  const r = tickerDailySummary(input());

  it('close and returns over 1W, 1M, 3M, YTD and 1Y', () => {
    expect(r.close).toBe(359);
    expect(r.close_date).toBe('2025-01-15');
    expect(r.return_1w).toBeCloseTo(359 / 354 - 1, 12); // 5 sessions back: bar 254
    expect(r.return_1m).toBeCloseTo(359 / 338 - 1, 12); // 21 back: bar 238
    expect(r.return_3m).toBeCloseTo(359 / 296 - 1, 12); // 63 back: bar 196
    expect(r.return_1y).toBeCloseTo(359 / 107 - 1, 12); // 252 back: bar 7
    expect(day(244)).toBe('2024-12-31');
    expect(r.return_ytd).toBeCloseTo(359 / 344 - 1, 12); // last close of 2024: bar 244
  });

  it('52-week closing range and where the close sits in it', () => {
    // The last 252 closes are bars 8 to 259: 108 to 359, the close at the top.
    expect(r.low_52w).toBe(108);
    expect(r.high_52w).toBe(359);
    expect(r.range_position_52w).toBe(1);
  });

  it('averages, trend flags, RSI, ATR and the stretch', () => {
    expect(r.sma_20).toBeCloseTo(349.5, 12); // mean of 340..359
    expect(r.sma_50).toBeCloseTo(334.5, 12); // mean of 310..359
    expect(r.sma_200).toBeCloseTo(259.5, 12); // mean of 160..359
    expect(r.above_sma_50).toBe(true);
    expect(r.above_sma_200).toBe(true);
    expect(r.rsi_14).toBe(100); // no down day
    // Every true range is 2 (high - low, and |high - previous close| = 2), so ATR 14 is 2.
    expect(r.atr_14_pct).toBeCloseTo(2 / 359, 12);
    expect(r.stretch_50_atr).toBeCloseTo((359 - 334.5) / 2, 12); // 12.25
  });

  it('volume and dollar volume over the 20 sessions before the newest', () => {
    // Bars 239..258: volume 1,239..1,258, mean 1,248.5; the newest volume is 1,259.
    expect(r.avg_volume_20).toBeCloseTo(1248.5, 9);
    expect(r.volume_ratio_20).toBeCloseTo(1259 / 1248.5, 12);
    // Mean of (100 + i)(1,000 + i) over i = 239..258: (20 x 100,000 + 1,100 x 4,970 + 1,235,710) / 20.
    expect(r.avg_dollar_volume_20).toBeCloseTo(435_135.5, 6);
  });

  it('strength against a flat SPY over 63 sessions is the stock return', () => {
    expect(r.rs_spy_63).toBeCloseTo(359 / 296 - 1, 12);
  });

  it('stamps its versions and sources', () => {
    expect(r.version).toBe(TICKER_SUMMARY_VERSION);
    expect(r.formula_versions).toMatchObject({
      summary: 'ticker-summary-1',
      watch: 'watch-1',
      returns: 'company-brief-1',
      trader: 'trader-1',
      sma: 'sma@1',
      rsi: 'rsi-wilder@1',
      atr: 'atr-wilder@1',
    });
    expect(r.sources['bars']).toEqual({
      source: 'massive',
      table: 'daily_bars',
      plan_tier: 'end-of-day',
      as_of: '2025-01-15',
      sessions: 260,
    });
  });
});

describe('tickerDailySummary: nulls with reasons when history is short', () => {
  it('1Y needs 253 bars, the 52-week range 252', () => {
    const r = tickerDailySummary(input({ bars: line(252), date: day(251) }));
    expect(r.return_1y).toBeNull();
    expect(r.unavailable['return_1y']).toBe('fewer than 253 bars');
    expect(r.high_52w).toBe(351);
    expect(r.low_52w).toBe(100);
    const short = tickerDailySummary(input({ bars: line(251), date: day(250) }));
    expect(short.high_52w).toBeNull();
    expect(short.range_position_52w).toBeNull();
    expect(short.unavailable['range_position_52w']).toBe('fewer than 252 bars');
  });

  it('each window says how many bars it needs', () => {
    const r = tickerDailySummary(input({ bars: line(14), date: day(13), spy: flatSpy(14) }));
    expect(r.atr_14_pct).toBeCloseTo(2 / 113, 12); // ATR's first value is at bar 13
    expect(r.rsi_14).toBeNull();
    expect(r.unavailable).toMatchObject({
      return_1m: 'fewer than 22 bars',
      return_3m: 'fewer than 64 bars',
      rsi_14: 'fewer than 15 bars',
      sma_20: 'fewer than 20 bars',
      sma_200: 'fewer than 200 bars',
      above_sma_50: 'fewer than 50 bars',
      stretch_50_atr: 'fewer than 50 bars',
      avg_volume_20: 'fewer than 21 bars',
      volume_ratio_20: 'fewer than 21 bars',
      rs_spy_63: 'fewer than 64 sessions shared with SPY',
      return_ytd: 'no bar before 2024-01-01',
    });
    expect(r.return_1w).toBeCloseTo(113 / 108 - 1, 12);
    // 20 bars: no ratio; 21: the first one.
    expect(tickerDailySummary(input({ bars: line(20), date: day(19) })).volume_ratio_20).toBeNull();
    expect(
      tickerDailySummary(input({ bars: line(21), date: day(20) })).volume_ratio_20,
    ).toBeCloseTo(1020 / 1009.5, 12);
  });

  it('no bars at all: every figure null with a reason, nothing thrown', () => {
    const r = tickerDailySummary(input({ bars: [], spy: null }));
    for (const k of SUMMARY_FIELDS) {
      expect(r[k], k).toBeNull();
      expect(r.unavailable[k], k).toBeTruthy();
    }
    expect(r.unavailable['close']).toBe('no stored bars');
    expect(r.unavailable['rs_spy_63']).toBe('SPY bars not loaded');
  });

  it('a year-to-date base must be a close in the last week of the previous year', () => {
    // Bars 0..199 then a gap to bar 250: the newest bar before 2025-01-01 is 2024-11-16, too old.
    const gap = [...line(200), ...Array.from({ length: 10 }, (_, k) => bar(250 + k))];
    const r = tickerDailySummary(input({ bars: gap }));
    expect(r.return_ytd).toBeNull();
    expect(r.unavailable['return_ytd']).toBe('no close in the last 7 days before 2025-01-01');
  });
});

describe('tickerDailySummary: point in time and guards', () => {
  it('ignores bars after the row date', () => {
    const r = tickerDailySummary(input({ date: day(258) }));
    expect(r.close).toBe(358);
    expect(r.close_date).toBe(day(258));
    expect(r.sources['bars']?.['sessions']).toBe(259);
  });

  it('refuses bars out of date order', () => {
    const bars = line(30);
    [bars[3], bars[4]] = [bars[4] as DailyBar, bars[3] as DailyBar];
    expect(() => tickerDailySummary(input({ bars }))).toThrow(/ascending date order/);
  });

  it('a market row carries price fields only', () => {
    const r = tickerDailySummary(input({ coverage: 'market', research: research(nvda, 'NVDA') }));
    expect(r.return_1y).toBeCloseTo(359 / 107 - 1, 12);
    expect(r.high_52w).toBe(359);
    for (const k of SUMMARY_FIELDS)
      if (!MARKET_FIELDS.has(k)) {
        expect(r[k], k).toBeNull();
        expect(r.unavailable[k]).toBe('not computed for market coverage');
      }
  });
});

describe('tickerDailySummary: dividends over the trailing 12 months', () => {
  const div = (exDividendDate: string, cashAmount: number, currency = 'USD') => ({
    exDividendDate,
    cashAmount,
    currency,
  });

  it('counts ex-dates in the 365 days ending on the close date', () => {
    const r = tickerDailySummary(
      input({
        dividends: [
          div('2024-01-16', 9), // 365 days before 2025-01-15: out
          div('2024-01-17', 0.25), // 364 days: in
          div('2024-07-01', 0.25),
          div('2025-01-15', 0.5), // on the close date: in
          div('2025-02-01', 7), // after the close date: out
        ],
      }),
    );
    expect(r.dividends_ttm).toBeCloseTo(1, 12);
    expect(r.dividend_yield_ttm).toBeCloseTo(1 / 359, 12);
    expect(r.sources['dividends']).toMatchObject({ counted: 3, window_days: 365 });
  });

  it('none paid is zero; not fetched or in another currency is unavailable', () => {
    expect(tickerDailySummary(input({ dividends: [] })).dividend_yield_ttm).toBe(0);
    const nf = tickerDailySummary(input({ dividends: null }));
    expect(nf.dividends_ttm).toBeNull();
    expect(nf.unavailable['dividends_ttm']).toBe('dividends not fetched for this ticker');
    const cad = tickerDailySummary(input({ dividends: [div('2024-12-01', 1, 'CAD')] }));
    expect(cad.dividends_ttm).toBeNull();
    expect(cad.unavailable['dividend_yield_ttm']).toBe('dividend in CAD');
  });
});

describe('tickerDailySummary: research and the next results date', () => {
  it('analyst count, mean target, recommendation, P/E, beta and sector fund from the stored Tauric parts', () => {
    const r = tickerDailySummary(input({ ticker: 'AAPL', research: research(aapl, 'AAPL') }));
    expect(r.analyst_count).toBe(39);
    expect(r.analyst_target_mean).toBe(345.6313);
    expect(r.analyst_recommendation).toBe('buy');
    expect(r.pe_ratio).toBe(39.9265);
    expect(r.beta).toBe(1.089);
    expect(r.sector_etf).toBe('XLK'); // Information Technology
    // AAPL's calendar states 2027-01-28, after the row date.
    expect(r.next_earnings_date).toBe('2027-01-28');
    expect(r.next_earnings_source).toBe('tauric');
    expect(r.formula_versions['research']).toBe('tauric-research-1');
  });

  it('falls back to Marsad’s estimate, and says why when neither is ahead', () => {
    // NVDA's calendar had no earnings on the recording day.
    const nv = research(nvda, 'NVDA');
    const est = tickerDailySummary(
      input({ research: nv, earningsEstimate: { date: '2025-02-26' } }),
    );
    expect(est.next_earnings_date).toBe('2025-02-26');
    expect(est.next_earnings_source).toBe('marsad-estimate');
    expect(est.formula_versions['earnings_estimate']).toBe('calendar-1');
    const past = tickerDailySummary(
      input({ research: nv, earningsEstimate: { date: '2025-01-15' } }),
    );
    expect(past.next_earnings_date).toBeNull();
    expect(past.unavailable['next_earnings_date']).toBe('no results date after 2025-01-15');
  });

  it('no research stored, or a part Tauric does not carry, gives its reason', () => {
    const none = tickerDailySummary(input());
    expect(none.analyst_count).toBeNull();
    expect(none.unavailable['analyst_count']).toBe('no company research stored');
    const etf = tickerDailySummary(
      input({
        research: {
          analyst: null,
          profile: null,
          calendar: null,
          analystRefreshedAt: null,
          profileRefreshedAt: null,
          calendarRefreshedAt: null,
          errors: { profile: 'not_registered', analyst: 'not_registered' },
        },
      }),
    );
    expect(etf.unavailable['pe_ratio']).toBe('no Tauric profile (not_registered)');
    expect(etf.unavailable['sector_etf']).toBe('no Tauric profile (not_registered)');
    expect(etf.unavailable['next_earnings_date']).toBe(
      'no Tauric calendar, and no Marsad estimate',
    );
  });

  it('maps every GICS sector to its Select Sector SPDR, and nothing else', () => {
    expect(sectorFundOf('Information Technology')).toBe('XLK');
    expect(sectorFundOf('health_care')).toBe('XLV');
    expect(sectorFundOf('Communication Services')).toBe('XLC');
    expect(sectorFundOf('Real Estate')).toBe('XLRE');
    expect(sectorFundOf('Technology')).toBeNull(); // not a GICS sector name
    expect(sectorFundOf(null)).toBeNull();
  });
});
