import { describe, expect, it } from 'vitest';
import nvda from '../../fixtures/tauric/research-NVDA-2026-11-28.json';
import aapl from '../../fixtures/tauric/research-AAPL-2026-11-28.json';
import nvdaDividends from '../../fixtures/massive/dividends-NVDA.json';
import {
  companyBrief,
  summarizeBars,
  tickerSummary,
  traderMetrics,
  validateAnalyst,
  validateCalendar,
  validateProfile,
  type DailyBar,
  type JobRunRecord,
  type Split,
} from '@marsad/core';
import {
  adjustedDividend,
  researchOf,
  runTickerSummaryJob,
  trackedTickers,
  type StoredDividendRow,
  type StoredResearchRow,
  type TickerSummaryStore,
  type TickerSummaryWrite,
} from './ticker-summary-job.js';

/** The last `n` weekdays ending on `end`, oldest first. */
function weekdays(n: number, end: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${end}T00:00:00Z`); out.length < n; t -= 86_400_000) {
    const w = new Date(t).getUTCDay();
    if (w !== 0 && w !== 6) out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out.reverse();
}

/** A deterministic random walk (a small LCG), so RSI, ATR and the averages are not trivial. */
function walk(n: number, end: string, start: number, seed: number): DailyBar[] {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
  let close = start;
  return weekdays(n, end).map((date) => {
    const open = close * (1 + rnd() * 0.01);
    close = Math.max(1, close * (1 + rnd() * 0.03));
    const high = Math.max(open, close) * (1 + Math.abs(rnd()) * 0.01);
    const low = Math.min(open, close) * (1 - Math.abs(rnd()) * 0.01);
    return { date, open, high, low, close, volume: Math.round(1e6 * (1.5 + rnd())), vwap: null };
  });
}

const SESSION = '2026-11-27'; // the Friday before a Saturday 11:25 UTC run
const BARS: Record<string, DailyBar[]> = {
  SPY: walk(500, SESSION, 600, 1),
  NVDA: walk(500, SESSION, 150, 2),
  AAPL: walk(500, SESSION, 230, 3),
  XLK: walk(500, SESSION, 250, 4),
  NEWCO: walk(30, SESSION, 20, 5),
  OLD: walk(300, '2026-11-20', 40, 6), // its bars stopped a week ago
};

/** The stored shape of a research row: each part as validated (what the research job writes). */
function storedResearch(fx: typeof nvda | typeof aapl, ticker: string): StoredResearchRow {
  const v = <T>(r: { ok: true; value: T } | { ok: false; reason: string }) =>
    r.ok ? r.value : null;
  return {
    ticker,
    analyst: v(validateAnalyst(fx.parts.analyst.body, ticker)),
    profile: v(validateProfile(fx.parts.profile.body, ticker)),
    calendar: v(validateCalendar(fx.parts.calendar.body, ticker)),
    analyst_refreshed_at: '2026-11-28T01:46:14Z',
    profile_refreshed_at: '2026-11-28T01:46:14Z',
    calendar_refreshed_at: '2026-11-28T01:46:14Z',
    errors: {},
  };
}

const DIVIDENDS: StoredDividendRow[] = nvdaDividends.body.results.map((d) => ({
  ticker: d.ticker,
  exDividendDate: d.ex_dividend_date,
  cashAmount: d.cash_amount,
  splitAdjustedCashAmount: d.split_adjusted_cash_amount ?? null,
  currency: d.currency,
}));

function fakeStore(over: Partial<TickerSummaryStore> = {}) {
  const written: TickerSummaryWrite[] = [];
  const runs: JobRunRecord[] = [];
  const store: TickerSummaryStore = {
    getHolidays: () =>
      Promise.resolve([
        { date: '2026-11-26', exchange: 'NYSE', name: 'Thanksgiving', status: 'closed' },
      ]),
    getHoldingTickers: () => Promise.resolve(['NVDA']),
    getWatchlistTickers: () => Promise.resolve(['AAPL', 'NEWCO', 'OLD', 'ZZZZ', 'bad ticker!']),
    getWatchlistSectorFunds: () => Promise.resolve([]),
    getDailyBars: (t) => Promise.resolve(BARS[t] ?? []),
    getResearch: (tickers) =>
      Promise.resolve(
        [storedResearch(nvda, 'NVDA'), storedResearch(aapl, 'AAPL')].filter((r) =>
          tickers.includes(r.ticker),
        ),
      ),
    getDividends: (tickers) => Promise.resolve(DIVIDENDS.filter((d) => tickers.includes(d.ticker))),
    getSplits: () => Promise.resolve([]),
    getEarningsEstimates: () => Promise.resolve([{ ticker: 'NVDA', date: '2027-02-25' }]),
    upsertSummaries: (rows) => {
      written.push(...rows);
      return Promise.resolve(rows.length);
    },
    recordRun: (run) => {
      runs.push(run);
      return Promise.resolve();
    },
    ...over,
  };
  return { store, written, runs };
}

const now = () => new Date('2026-11-28T11:25:00Z');
const rowOf = (rows: readonly TickerSummaryWrite[], t: string) => {
  const r = rows.find((x) => x.ticker === t);
  if (!r) throw new Error(`no row for ${t}`);
  return r;
};

describe('runTickerSummaryJob (fake store)', () => {
  it('writes one tracked row per holding, watchlist ticker, SPY and sector fund, and records the run', async () => {
    const { store, written, runs } = fakeStore();
    const run = await runTickerSummaryJob({ store, now });
    expect(run.status).toBe('ok');
    // SPY first, then the holding, the watchlist (a bad symbol dropped), then AAPL's GICS fund (XLK).
    expect(written.map((r) => r.ticker)).toEqual([
      'SPY',
      'NVDA',
      'AAPL',
      'NEWCO',
      'OLD',
      'ZZZZ',
      'XLK',
    ]);
    expect(written.every((r) => r.coverage === 'tracked' && r.date === SESSION)).toBe(true);
    expect(written.every((r) => r.computed_at === '2026-11-28T11:25:00.000Z')).toBe(true);
    expect(run.rows_written).toBe(7);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.job).toBe('ticker-summary');
    expect(run.details).toMatchObject({
      version: 'ticker-summary-1',
      date: SESSION,
      tracked: 7,
      market: 0,
      withResearch: 2,
      noBars: ['ZZZZ'],
      stale: ['OLD (2026-11-20)'],
    });
  });

  it('fills research, dividends and the next results date from what is stored', async () => {
    const { store, written } = fakeStore();
    await runTickerSummaryJob({ store, now });
    const n = rowOf(written, 'NVDA');
    expect(n.analyst_count).toBe(59);
    expect(n.analyst_target_mean).toBe(242.4278);
    expect(n.pe_ratio).toBe(16.1643);
    expect(n.beta).toBe(2.247);
    expect(n.sector_etf).toBe('XLK');
    // Ex-dates 2025-12-04, 2026-03-11, 2026-06-04 and 2026-09-10 fall in the 365 days to 2026-11-27.
    expect(n.dividends_ttm).toBeCloseTo(0.01 + 0.01 + 0.25 + 0.25, 12);
    expect(n.dividend_yield_ttm).toBeCloseTo(0.52 / (n.close as number), 12);
    // Tauric had no NVDA earnings that day, so Marsad's estimate is used.
    expect(n.next_earnings_date).toBe('2027-02-25');
    expect(n.next_earnings_source).toBe('marsad-estimate');
    const a = rowOf(written, 'AAPL');
    expect(a.next_earnings_source).toBe('tauric');
    expect(a.dividends_ttm).toBeNull(); // the study-data job does not fetch AAPL's dividends
    expect(a.unavailable['dividends_ttm']).toBe('dividends not fetched for this ticker');
    const z = rowOf(written, 'ZZZZ');
    expect(z.close).toBeNull();
    expect(z.unavailable['close']).toBe('no stored bars');
    const nc = rowOf(written, 'NEWCO');
    expect(nc.return_1y).toBeNull();
    expect(nc.unavailable['return_1y']).toBe('fewer than 253 bars');
  });

  it('a stored research part that no longer validates is dropped with its reason', async () => {
    const bad = { ...storedResearch(nvda, 'NVDA'), analyst: { number_of_analysts: -1 } };
    const { store, written } = fakeStore({ getResearch: () => Promise.resolve([bad]) });
    await runTickerSummaryJob({ store, now });
    const n = rowOf(written, 'NVDA');
    expect(n.analyst_count).toBeNull();
    expect(n.unavailable['analyst_count']).toMatch(/^no Tauric analyst \(malformed: /);
    expect(n.pe_ratio).toBe(16.1643);
  });

  it('a ticker that fails is named and the run is an error, after the others are written', async () => {
    const { store, written } = fakeStore({
      getDailyBars: (t) =>
        t === 'NEWCO'
          ? Promise.reject(new Error('daily_bars read failed: timeout'))
          : Promise.resolve(BARS[t] ?? []),
    });
    const run = await runTickerSummaryJob({ store, now });
    expect(run.status).toBe('error');
    expect(run.error).toMatch(/NEWCO: daily_bars read failed: timeout/);
    expect(written.map((r) => r.ticker)).not.toContain('NEWCO');
    expect(written).toHaveLength(6);
  });

  it('is idempotent: a second run the same day writes the same rows', async () => {
    const one = fakeStore();
    const two = fakeStore();
    await runTickerSummaryJob({ store: one.store, now });
    await runTickerSummaryJob({ store: two.store, now });
    expect(two.written).toEqual(one.written);
  });

  it('a dividend without the vendor adjustment is put on today’s share basis by the stored splits', () => {
    const split: Split = {
      ticker: 'NVDA',
      executionDate: '2024-06-10',
      splitFrom: 1,
      splitTo: 10,
      adjustmentType: 'forward_split',
    };
    const d = { ticker: 'NVDA', exDividendDate: '2024-03-05', cashAmount: 0.04, currency: 'USD' };
    expect(
      adjustedDividend({ ...d, splitAdjustedCashAmount: null }, [split]).cashAmount,
    ).toBeCloseTo(0.004, 12);
    expect(adjustedDividend({ ...d, splitAdjustedCashAmount: 0.004 }, []).cashAmount).toBe(0.004);
  });

  it('tracks SPY first and each valid ticker once', () => {
    expect(trackedTickers(['nvda', 'NVDA'], ['SPY', 'x y'], ['XLK'])).toEqual([
      'SPY',
      'NVDA',
      'XLK',
    ]);
    expect(researchOf(storedResearch(aapl, 'AAPL')).errors).toEqual({});
  });
});

/**
 * Parity (ADR 0048 section 4): for the same bars the job's row equals what the pages compute today, through the same
 * core calls. Watch (WatchlistCard) reads the newest 260 bars and calls tickerSummary and traderMetrics; the quick
 * look reads all stored bars (up to 1,000) and calls summarizeBars, traderMetrics and companyBrief.
 */
describe('parity with the browser (Watch row and quick-look performance)', () => {
  it('equals Watch and the quick look field by field; the known differences are pinned', async () => {
    const { store, written } = fakeStore();
    await runTickerSummaryJob({ store, now });
    for (const t of ['NVDA', 'AAPL', 'XLK', 'NEWCO']) {
      const row = rowOf(written, t);
      const all = BARS[t] as DailyBar[];
      const spyAll = BARS['SPY'] as DailyBar[];
      // Watch: the newest 260 bars of the ticker and of SPY (lib/watch.ts barsOf).
      const watchBars = all.slice(-260);
      const s = tickerSummary(watchBars);
      const m = traderMetrics(watchBars, spyAll.slice(-260));
      // Quick look: every stored bar (lib/study.ts loadStudy), SPY from its own read.
      const q = summarizeBars(all);
      const qm = traderMetrics(all, spyAll);
      const brief = companyBrief({
        ticker: t,
        asOf: SESSION,
        name: null,
        business: null,
        bars: all,
        spy: spyAll,
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
      const r = brief.performance.returns;

      // Exactly equal: the same function over the same bars.
      expect(row.close, t).toBe(s?.close);
      expect(row.close, t).toBe(q?.lastClose);
      expect(row.close_date, t).toBe(s?.date);
      expect(row.return_1w, t).toBe(s?.change5d ?? null);
      expect(row.return_1m, t).toBe(r.m1?.stock ?? null);
      expect(row.return_1m, t).toBe(s?.change21d ?? null);
      expect(row.return_3m, t).toBe(r.m3?.stock ?? null);
      expect(row.return_1y, t).toBe(r.y1?.stock ?? null);
      expect(row.high_52w, t).toBe(s?.range252?.high ?? null);
      expect(row.low_52w, t).toBe(s?.range252?.low ?? null);
      expect(row.range_position_52w, t).toBe(s?.range252?.position ?? null);
      expect(row.sma_50, t).toBe(q?.sma50 ?? null);
      expect(row.sma_200, t).toBe(q?.sma200 ?? null);
      expect(row.rsi_14, t).toBe(q?.rsi14 ?? null);
      expect(row.volume_ratio_20, t).toBe(s?.volumeRatio20 ?? null);
      expect(row.volume_ratio_20, t).toBe(q?.rvol20 ?? null);
      expect(row.atr_14_pct, t).toBe(qm?.atrPct ?? null);
      expect(row.stretch_50_atr, t).toBe(qm?.stretch50 ?? null);
      expect(row.rs_spy_63, t).toBe(m?.rsSpy ?? null);
      expect(row.rs_spy_63, t).toBe(qm?.rsSpy ?? null);
      if (q && q.sma50 !== null && q.sma200 !== null) {
        expect(row.above_sma_50, t).toBe(
          q.trend === 'above-both' || q.trend === 'above-50-below-200',
        );
        expect(row.above_sma_200, t).toBe(
          q.trend === 'above-both' || q.trend === 'below-50-above-200',
        );
      }

      // Difference 1: Watch seeds Wilder's ATR at the start of its 260 bars, the row at the start of all bars.
      // After 246 smoothing steps the seed's weight is (13/14)^246, about 1e-8, so they agree to 1e-6.
      if (all.length > 260 && row.atr_14_pct !== null && m?.atrPct != null) {
        expect(Math.abs(row.atr_14_pct / m.atrPct - 1), t).toBeLessThan(1e-6);
      }
    }

    // Difference 2: the quick look's 52-week range is the intraday high and low over up to 252 bars (and a shorter
    // window when history is short); the row and Watch use closes over exactly 252 sessions.
    const nv = rowOf(written, 'NVDA');
    const qn = summarizeBars(BARS['NVDA'] as DailyBar[]);
    expect(qn?.high52w).toBeGreaterThan(nv.high_52w as number);
    expect(qn?.low52w).toBeLessThan(nv.low_52w as number);
    expect(rowOf(written, 'NEWCO').high_52w).toBeNull();
    expect(summarizeBars(BARS['NEWCO'] as DailyBar[])?.rangeSessions).toBe(30);
  });
});
