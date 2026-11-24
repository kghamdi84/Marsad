import { describe, expect, it } from 'vitest';
import {
  HttpClient,
  TokenBucket,
  type Clock,
  type FetchLike,
  type FredObservation,
  type JobRunRecord,
} from '@marsad/core';
import { runFredJob } from './fred-job.js';
import type { SourceStatusUpdate, Store } from './store.js';

const NOW = new Date('2026-11-24T23:30:00Z');

function fakeStore() {
  const log = {
    upserts: [] as { series: string; n: number }[],
    runs: [] as JobRunRecord[],
    statuses: [] as SourceStatusUpdate[],
  };
  const store: Store = {
    upsertGprDays: () => Promise.resolve(0),
    upsertFredObservations: (series, obs: readonly FredObservation[]) => {
      log.upserts.push({ series, n: obs.length });
      return Promise.resolve(obs.length);
    },
    recordRun: (r) => {
      log.runs.push(r);
      return Promise.resolve();
    },
    updateSourceStatus: (u) => {
      log.statuses.push(u);
      return Promise.resolve();
    },
  };
  return { store, log };
}

/** A synthetic FRED body in the documented shape; series whose id is in `failing` return HTTP 500. */
function http(failing: string[] = [], empty: string[] = []): HttpClient {
  const clock: Clock = { now: () => NOW.getTime(), sleep: () => Promise.resolve() };
  const fetch: FetchLike = (url) => {
    const id = /series_id=([A-Z0-9]+)/.exec(url)?.[1] ?? '';
    const status = failing.includes(id) ? 500 : 200;
    const observations = empty.includes(id)
      ? []
      : [
          { date: '2026-11-20', value: '4.05' },
          { date: '2026-11-21', value: '.' },
          { date: '2026-11-23', value: '4.11' },
        ];
    return Promise.resolve({
      status,
      headers: { get: () => null },
      text: () => Promise.resolve(JSON.stringify({ observations })),
    });
  };
  return new HttpClient({ fetch, clock, bucket: new TokenBucket(100, 100, clock), maxRetries: 0 });
}

describe('runFredJob (SYNTHETIC FRED bodies)', () => {
  it('stores all 12 series, records an ok run and marks the source live', async () => {
    const { store, log } = fakeStore();
    const run = await runFredJob({ http: http(), apiKey: 'k', store, now: () => NOW });
    expect(run).toMatchObject({ job: 'fred-daily', status: 'ok', rows_written: 36, error: null });
    expect(log.upserts).toHaveLength(12);
    expect(log.statuses[0]).toMatchObject({
      source: 'fred',
      state: 'live',
      planTier: 'end-of-day',
      note: '12 series updated',
    });
    expect(log.runs).toEqual([run]);
  });

  it('keeps the series that worked, names the ones that failed, and does not mark the source live', async () => {
    const { store, log } = fakeStore();
    const run = await runFredJob({
      http: http(['NFCI', 'ICSA']),
      apiKey: 'k',
      store,
      now: () => NOW,
    });
    expect(run.status).toBe('error');
    expect(run.error).toBe('FRED series failed: NFCI: server-error, ICSA: server-error');
    expect(log.upserts).toHaveLength(10);
    expect(log.statuses).toEqual([]);
  });

  it('treats an empty series as a failure, not as success', async () => {
    const { store } = fakeStore();
    const run = await runFredJob({
      http: http([], ['VIXCLS']),
      apiKey: 'k',
      store,
      now: () => NOW,
    });
    expect(run.status).toBe('error');
    expect(run.error).toContain('VIXCLS: empty');
  });

  it('logs only public values for sampling, never the key', async () => {
    const { store } = fakeStore();
    const lines: string[] = [];
    await runFredJob({
      http: http(),
      apiKey: 'super-secret-key',
      store,
      now: () => NOW,
      logSample: (s, o) => lines.push(`${s} ${JSON.stringify(o)}`),
    });
    expect(lines).toHaveLength(12);
    expect(lines.join('\n')).not.toContain('super-secret-key');
  });
});
