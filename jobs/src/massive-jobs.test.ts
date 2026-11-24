import { describe, expect, it } from 'vitest';
import holidays from '../../fixtures/massive/market-status-upcoming.json';
import splitsFixture from '../../fixtures/massive/splits-NVDA.json';
import yields from '../../fixtures/massive/treasury-yields.json';
import {
  HttpClient,
  TokenBucket,
  type Clock,
  type FetchLike,
  type FredObservation,
  type MassiveConfig,
} from '@marsad/core';
import { fakeStore } from './fake-store.js';
import { runMassiveReferenceJob } from './massive-reference-job.js';
import { runReconcileJob } from './reconcile-job.js';

const NOW = new Date('2026-11-24T05:30:00Z');
const cfg: MassiveConfig = { apiKey: 'test-key', planTier: 'end-of-day', now: () => NOW };

/** Routes by path to bodies built from the recorded fixtures. `overrides` maps a path fragment to a response. */
function http(overrides: Record<string, { status: number; body: string }> = {}): HttpClient {
  const clock: Clock = { now: () => NOW.getTime(), sleep: () => Promise.resolve() };
  const fetch: FetchLike = (url) => {
    for (const [fragment, r] of Object.entries(overrides)) {
      if (url.includes(fragment))
        return Promise.resolve({
          status: r.status,
          headers: { get: () => null },
          text: () => Promise.resolve(r.body),
        });
    }
    let body = '{}';
    if (url.includes('/v1/marketstatus/upcoming')) body = JSON.stringify(holidays.data);
    else if (url.includes('/stocks/v1/splits'))
      body = JSON.stringify({ results: splitsFixture.data });
    else if (url.includes('/fed/v1/treasury-yields'))
      body = JSON.stringify({ results: yields.data });
    return Promise.resolve({
      status: 200,
      headers: { get: () => null },
      text: () => Promise.resolve(body),
    });
  };
  return new HttpClient({ fetch, clock, bucket: new TokenBucket(100, 100, clock), maxRetries: 0 });
}

describe('runMassiveReferenceJob (recorded Massive rows)', () => {
  it('stores the calendar and splits, and marks the reference source live', async () => {
    const { store, log } = fakeStore();
    const run = await runMassiveReferenceJob({
      http: http(),
      cfg,
      store,
      now: () => NOW,
      tickers: ['NVDA', 'SPY'],
    });
    expect(run.status).toBe('ok');
    expect(log.holidays[0]).toHaveLength(24);
    expect(log.splits[0]).toHaveLength(6); // three recorded rows per ticker, two tickers
    expect(log.splits[0]?.[0]).toMatchObject({
      vendorId: expect.stringMatching(/^E/) as string,
      historicalAdjustmentFactor: 0.1,
    });
    expect(log.statuses[0]).toMatchObject({
      source: 'massive_reference',
      state: 'live',
      planTier: 'end-of-day',
    });
    expect(log.runs).toEqual([run]);
  });

  it('names a plan problem as "requires plan" and does not mark the source live', async () => {
    const denied = {
      status: 403,
      body: JSON.stringify({
        status: 'NOT_AUTHORIZED',
        message: 'You are not entitled to this data.',
      }),
    };
    const { store, log } = fakeStore();
    const run = await runMassiveReferenceJob({
      http: http({ '/stocks/v1/splits': denied }),
      cfg,
      store,
      now: () => NOW,
      tickers: ['NVDA'],
    });
    expect(run.status).toBe('error');
    expect(run.error).toContain('splits NVDA: Requires a higher Massive plan (not-entitled)');
    expect(log.holidays).toHaveLength(1); // the calendar still stored
    expect(log.statuses).toEqual([]);
  });

  it('records the error when the whole API is down', async () => {
    const { store } = fakeStore();
    const run = await runMassiveReferenceJob({
      http: http({ '/': { status: 503, body: 'down' } }),
      cfg,
      store,
      now: () => NOW,
      tickers: ['NVDA'],
    });
    expect(run.status).toBe('error');
    expect(run.error).toContain('calendar: Massive is having problems (server-error)');
  });
});

const fred = (rows: [string, number | null][]): FredObservation[] =>
  rows.map(([date, value]) => ({ date, value }));
// FRED values matching the recorded Massive yields (checked by hand on 2026-11-24).
const matching = {
  DGS10: fred([
    ['2026-11-18', 5.07],
    ['2026-11-19', 5.04],
    ['2026-11-20', 4.92],
  ]),
  T10Y3M: fred([
    ['2026-11-18', 0.73],
    ['2026-11-19', 0.7],
    ['2026-11-20', 0.6],
  ]),
  T10Y2Y: fred([
    ['2026-11-18', 0.27],
    ['2026-11-19', 0.28],
    ['2026-11-20', 0.29],
  ]),
};

describe('runReconcileJob', () => {
  it('passes when Massive and FRED agree, comparing yields and both spreads on each date', async () => {
    const { store } = fakeStore(matching);
    const run = await runReconcileJob({ http: http(), cfg, store, now: () => NOW });
    expect(run.status).toBe('ok');
    expect(run.rows_written).toBe(9);
    expect(run.details).toMatchObject({
      checks: 9,
      dates: ['2026-11-18', '2026-11-19', '2026-11-20'],
    });
  });

  it('fails loudly when a value disagrees beyond tolerance', async () => {
    const bad = {
      ...matching,
      DGS10: fred([
        ['2026-11-18', 5.07],
        ['2026-11-19', 5.04],
        ['2026-11-20', 5.25],
      ]),
    };
    const { store } = fakeStore(bad);
    const run = await runReconcileJob({ http: http(), cfg, store, now: () => NOW });
    expect(run.status).toBe('error');
    expect(run.error).toContain('10y yield 2026-11-20');
  });

  it('fails when there is nothing to compare, instead of passing quietly', async () => {
    const { store } = fakeStore({});
    const run = await runReconcileJob({ http: http(), cfg, store, now: () => NOW });
    expect(run).toMatchObject({
      status: 'error',
      error: 'Nothing to reconcile: no date has both Massive and FRED yields',
    });
  });

  it('skips dates FRED has not published and still checks the rest', async () => {
    const partial = {
      ...matching,
      DGS10: fred([
        ['2026-11-18', 5.07],
        ['2026-11-19', null],
        ['2026-11-20', 4.92],
      ]),
    };
    const { store } = fakeStore(partial);
    const run = await runReconcileJob({ http: http(), cfg, store, now: () => NOW });
    expect(run.status).toBe('ok');
    expect(run.details).toMatchObject({ dates: ['2026-11-18', '2026-11-20'] });
  });

  it('reports when Massive yields are unavailable on the plan', async () => {
    const denied = {
      status: 403,
      body: JSON.stringify({ status: 'NOT_AUTHORIZED', message: 'not entitled' }),
    };
    const { store } = fakeStore(matching);
    const run = await runReconcileJob({
      http: http({ '/fed/v1/treasury-yields': denied }),
      cfg,
      store,
      now: () => NOW,
    });
    expect(run.error).toBe(
      'Massive yields unavailable: Requires a higher Massive plan (not-entitled)',
    );
  });
});
