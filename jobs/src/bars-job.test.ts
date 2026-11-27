import { describe, expect, it } from 'vitest';
import dailyWeek from '../../fixtures/massive/aggs-SPY-1d-2026-11-16-to-20.json';
import holidays from '../../fixtures/massive/market-status-upcoming.json';
import notEntitled from '../../fixtures/massive/not-entitled-403.json';
import {
  HttpClient,
  TokenBucket,
  type Clock,
  type FetchLike,
  type MassiveConfig,
  type UpcomingRow,
} from '@marsad/core';
import { MAX_WATCHLIST_EXTRAS, runBarsJob, watchlistExtras } from './bars-job.js';
import { fakeStore } from './fake-store.js';

const AFTER_CLOSE = new Date('2026-11-24T22:30:00Z'); // Tuesday 17:30 ET
const MID_SESSION_FRIDAY = new Date('2026-11-20T18:00:00Z'); // Friday 13:00 ET, session not over
const cfgAt = (now: Date): MassiveConfig => ({
  apiKey: 'k',
  planTier: 'end-of-day',
  now: () => now,
});
const seed = { holidays: holidays.data as UpcomingRow[] };

function http(at: Date, route: (url: string) => { status: number; body: unknown }): HttpClient {
  const clock: Clock = { now: () => at.getTime(), sleep: () => Promise.resolve() };
  const fetch: FetchLike = (url) => {
    const r = route(url);
    return Promise.resolve({
      status: r.status,
      headers: { get: () => null },
      text: () => Promise.resolve(JSON.stringify(r.body)),
    });
  };
  return new HttpClient({ fetch, clock, bucket: new TokenBucket(100, 100, clock), maxRetries: 0 });
}

const real = () => ({ status: 200, body: dailyWeek.body });

describe('runBarsJob on the real SPY bars recorded 2026-11-24', () => {
  it('stores every bar of every tracked ticker and marks the source live', async () => {
    const { store, log } = fakeStore(seed);
    const run = await runBarsJob({
      http: http(AFTER_CLOSE, real),
      cfg: cfgAt(AFTER_CLOSE),
      store,
      now: () => AFTER_CLOSE,
      tickers: ['SPY', 'QQQ'],
    });
    expect(run).toMatchObject({ status: 'ok', rows_written: 10 });
    expect(run.details).toMatchObject({ tickers: 2, latest: '2026-11-20' });
    expect(log.bars.map((b) => [b.ticker, b.bars.length])).toEqual([
      ['SPY', 5],
      ['QQQ', 5],
    ]);
    expect(log.bars[0]?.bars[4]).toMatchObject({ c: 689.81, vw: 701.8443 });
    expect(log.statuses[0]).toMatchObject({
      source: 'massive_bars',
      state: 'live',
      planTier: 'end-of-day',
    });
  });

  it('asks for the two-year window the free plan allows', async () => {
    const urls: string[] = [];
    const { store } = fakeStore(seed);
    await runBarsJob({
      http: http(AFTER_CLOSE, (u) => (urls.push(u), real())),
      cfg: cfgAt(AFTER_CLOSE),
      store,
      now: () => AFTER_CLOSE,
      tickers: ['SPY'],
    });
    expect(urls[0]).toContain(
      '/v2/aggs/ticker/SPY/range/1/day/2024-11-24/2026-11-24?adjusted=true',
    );
  });

  it('leaves out the bar of a session that has not finished, so a partial day is never stored', async () => {
    const { store, log } = fakeStore(seed);
    const run = await runBarsJob({
      http: http(MID_SESSION_FRIDAY, real),
      cfg: cfgAt(MID_SESSION_FRIDAY),
      store,
      now: () => MID_SESSION_FRIDAY,
      tickers: ['SPY'],
    });
    expect(run.status).toBe('ok');
    expect(log.bars[0]?.bars).toHaveLength(4); // 2026-11-16 to 2026-11-19, not Friday's partial bar
    expect(run.details).toMatchObject({ latest: '2026-11-19' });
  });

  it('names a ticker the plan does not cover and does not mark the source live', async () => {
    const { store, log } = fakeStore(seed);
    const run = await runBarsJob({
      http: http(AFTER_CLOSE, (u) =>
        u.includes('/QQQ/') ? { status: 403, body: notEntitled.body } : real(),
      ),
      cfg: cfgAt(AFTER_CLOSE),
      store,
      now: () => AFTER_CLOSE,
      tickers: ['SPY', 'QQQ'],
    });
    expect(run.status).toBe('error');
    expect(run.error).toBe('Daily bars failed: QQQ: Requires a higher Massive plan (not-entitled)');
    expect(log.statuses).toEqual([]);
    expect(log.runs).toHaveLength(1);
  });

  it('treats a ticker that returns no bars as a failure, not as nothing to do', async () => {
    const { store } = fakeStore(seed);
    const run = await runBarsJob({
      http: http(AFTER_CLOSE, () => ({
        status: 200,
        body: { status: 'OK', resultsCount: 0, results: [] },
      })),
      cfg: cfgAt(AFTER_CLOSE),
      store,
      now: () => AFTER_CLOSE,
      tickers: ['SPY'],
    });
    expect(run.error).toContain('SPY: no bars returned');
  });
});

describe('saved watchlist tickers in the nightly bars run', () => {
  it('adds them once, valid symbols only, sorted and capped', () => {
    expect(watchlistExtras([' pltr', 'NVDA', 'PLTR', 'BRK.B', 'bad ticker!', '', 'AMD'])).toEqual([
      'AMD',
      'BRK.B',
      'PLTR',
    ]);
    const many = Array.from({ length: 60 }, (_, i) => `T${String(i).padStart(2, '0')}`);
    expect(watchlistExtras(many)).toHaveLength(MAX_WATCHLIST_EXTRAS);
  });

  it('fetches a ticker that is only on a saved watchlist', async () => {
    const asked: string[] = [];
    const { store } = fakeStore({ ...seed, watchlist: ['PLTR'] });
    await runBarsJob({
      http: http(AFTER_CLOSE, (url) => {
        asked.push(url);
        return real();
      }),
      cfg: cfgAt(AFTER_CLOSE),
      store,
      now: () => AFTER_CLOSE,
    });
    expect(asked.some((u) => u.includes('/ticker/PLTR/'))).toBe(true);
  });
});
