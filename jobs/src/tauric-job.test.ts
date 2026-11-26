import { describe, expect, it } from 'vitest';
import recorded from '../../fixtures/tauric/quotes-2026-11-26.json';
import upcoming from '../../fixtures/massive/market-status-upcoming.json';
import {
  HttpClient,
  TokenBucket,
  classifyTauricFailure,
  type Clock,
  type FetchLike,
  type JobRunRecord,
  type TauricQuote,
  type UpcomingRow,
} from '@marsad/core';
import {
  quoteTickers,
  runTauricQuotesJob,
  runTauricReconcileJob,
  type TauricStore,
} from './tauric-job.js';
import type { SourceStatusUpdate } from './store.js';

function fake(bars: Record<string, { date: string; close: number; volume: number }> = {}) {
  const log = {
    runs: [] as JobRunRecord[],
    status: [] as SourceStatusUpdate[],
    quotes: [] as TauricQuote[],
  };
  const store: TauricStore = {
    getHolidays: () => Promise.resolve(upcoming.data as UpcomingRow[]),
    getWatchlistTickers: () => Promise.resolve(['NVDA', 'AAPL']),
    upsertQuotes: (q) => {
      log.quotes.push(...q);
      return Promise.resolve(q.length);
    },
    getLatestDailyBar: (t) => Promise.resolve(bars[t] ?? null),
    recordRun: (r) => {
      log.runs.push(r);
      return Promise.resolve();
    },
    updateSourceStatus: (u) => {
      log.status.push(u);
      return Promise.resolve();
    },
  };
  return { store, log };
}

function http(status: number, body: string, at: Date) {
  const calls: string[] = [];
  const clock: Clock = { now: () => at.getTime(), sleep: () => Promise.resolve() };
  const fetch: FetchLike = (_url, init) => {
    calls.push(init?.body ?? '');
    return Promise.resolve({
      status,
      headers: { get: () => null },
      text: () => Promise.resolve(body),
    });
  };
  return {
    http: new HttpClient({
      fetch,
      clock,
      bucket: new TokenBucket(100, 100, clock),
      classify: classifyTauricFailure,
      maxRetries: 0,
    }),
    calls,
  };
}

const deps = (at: Date, status = 200, body = JSON.stringify(recorded.body), bars = {}) => {
  const f = fake(bars);
  const h = http(status, body, at);
  return {
    ...f,
    calls: h.calls,
    deps: { http: h.http, cfg: { apiKey: 'k', now: () => at }, store: f.store, now: () => at },
  };
};

describe('quoteTickers', () => {
  it('puts the starting list first, adds saved watchlists once, and caps one batch at 50', () => {
    const { tickers, left } = quoteTickers(['NVDA', 'AAPL']);
    expect(tickers.slice(0, 2)).toEqual(['NVDA', 'RKLB']);
    expect(tickers.at(-1)).toBe('AAPL');
    expect(tickers.filter((t) => t === 'NVDA')).toHaveLength(1);
    expect(left).toBe(0);
    const many = Array.from({ length: 60 }, (_, i) => `Z${i}`);
    expect(quoteTickers(many)).toMatchObject({ left: 24 });
    expect(quoteTickers(many).tickers).toHaveLength(50);
  });
});

describe('runTauricQuotesJob', () => {
  it('in the regular session: one batch call, stores the quotes and reports the delay as not confirmed', async () => {
    const at = new Date('2026-11-24T15:00:00Z'); // Tuesday 10:00 ET
    const t = deps(at);
    const run = await runTauricQuotesJob(t.deps);
    expect(run.status).toBe('ok');
    expect(t.calls).toHaveLength(1);
    expect(JSON.parse(t.calls[0] ?? '{}').instruments).toContain('security:AAPL');
    expect(t.log.quotes.map((q) => q.ticker)).toEqual(['AAPL', 'NVDA', 'SPY']);
    expect(t.log.status[0]).toMatchObject({ source: 'tauric', planTier: 'unknown' });
    // 14 starting tickers plus AAPL from a saved watchlist (NVDA is already on the starting list).
    expect(t.log.status[0]?.note).toBe(
      '3 of 15 quotes; delay not confirmed (ADR 0041); no quote: fx:EURUSD (not-a-security), crypto:BTC-USD (not_registered)',
    );
    expect(t.log.runs[0]?.job).toBe('tauric-quotes');
  });

  it('outside the session it spends no credit and records a skipped run', async () => {
    const at = new Date('2026-11-26T15:00:00Z'); // Thanksgiving
    const t = deps(at);
    const run = await runTauricQuotesJob(t.deps);
    expect(run.status).toBe('skipped');
    expect(t.calls).toHaveLength(0);
    expect(t.log.status).toHaveLength(0);
  });

  it('polls once more within 15 minutes after the close, to catch the closing price', async () => {
    const t = deps(new Date('2026-11-24T21:10:00Z')); // 16:10 ET
    expect((await runTauricQuotesJob(t.deps)).status).toBe('ok');
    const late = deps(new Date('2026-11-24T21:20:00Z')); // 16:20 ET
    expect((await runTauricQuotesJob(late.deps)).status).toBe('skipped');
  });

  it('a rejected key is an error run that writes nothing and leaves the heartbeat alone', async () => {
    const t = deps(
      new Date('2026-11-24T15:00:00Z'),
      401,
      JSON.stringify({ error: { code: 'invalid_api_key', message: 'no' } }),
    );
    const run = await runTauricQuotesJob(t.deps);
    expect(run.status).toBe('error');
    expect(run.error).toBe('Tauric quotes unavailable: Tauric rejected the API key (auth-failed)');
    expect(t.log.quotes).toHaveLength(0);
    expect(t.log.status).toHaveLength(0);
  });
});

describe('runTauricReconcileJob', () => {
  const at = new Date('2026-11-26T15:00:00Z');

  it('fails loudly when a starting ticker has no Tauric quote or no Massive bar to compare', async () => {
    const t = deps(at, 200, JSON.stringify(recorded.body), {
      NVDA: { date: '2026-11-25', close: 149.3, volume: 366571890 },
      SPY: { date: '2026-11-25', close: 716.7, volume: 73112796 },
    });
    const run = await runTauricReconcileJob(t.deps);
    expect(run.status).toBe('error');
    expect(run.error).toMatch(
      /^Tauric and Massive disagree: RKLB close \(Tauric gave no quote, cannot verify\)/,
    );
    expect(run.error).not.toMatch(/NVDA/); // NVDA and SPY agree to the cent and within the volume tolerance
  });

  it('passes when every starting ticker agrees', async () => {
    const tickers = [
      'NVDA',
      'RKLB',
      'MARA',
      'SOFI',
      'HOOD',
      'OKLO',
      'IONQ',
      'HIMS',
      'RGTI',
      'BBAI',
      'SPY',
      'QQQ',
      'IWM',
      'DIA',
    ];
    const body = {
      object: 'list',
      next_cursor: null,
      errors: [],
      data: tickers.map((tk) => ({
        key: `security:${tk}`,
        quote_kind: 'snapshot',
        price: 10,
        price_time: '2026-11-25T21:00:00Z',
        session_date: '2026-11-25',
        day: { volume: 1000 },
        field_states: {},
        instrument: {},
      })),
    };
    const bars = Object.fromEntries(
      tickers.map((tk) => [tk, { date: '2026-11-25', close: 10, volume: 1030 }]),
    );
    const t = deps(at, 200, JSON.stringify(body), bars);
    const run = await runTauricReconcileJob(t.deps);
    expect(run.status).toBe('ok');
    expect(run.rows_written).toBe(28);
    expect(t.log.runs[0]?.job).toBe('tauric-reconcile');
  });
});
