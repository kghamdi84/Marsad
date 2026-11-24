import { describe, expect, it } from 'vitest';
import fixture from '../../fixtures/nasdaq-halts-rss.json';
import { HttpClient, TokenBucket, type Clock, type FetchLike } from '@marsad/core';
import { fakeStore } from './fake-store.js';
import { runHaltsJob } from './halts-job.js';

const NOW = new Date('2026-11-23T19:40:00Z');

function http(status: number, body: string): { http: HttpClient; uas: (string | undefined)[] } {
  const uas: (string | undefined)[] = [];
  const clock: Clock = { now: () => NOW.getTime(), sleep: () => Promise.resolve() };
  const fetch: FetchLike = (_url, init) => {
    uas.push(init?.headers?.['User-Agent']);
    return Promise.resolve({
      status,
      headers: { get: () => null },
      text: () => Promise.resolve(body),
    });
  };
  return {
    http: new HttpClient({ fetch, clock, bucket: new TokenBucket(100, 100, clock), maxRetries: 0 }),
    uas,
  };
}

describe('runHaltsJob on the recorded Nasdaq feed', () => {
  it('stores every halt, counts the active and news-related ones, and marks the source live', async () => {
    const { store, log } = fakeStore();
    const h = http(200, fixture.xml);
    const run = await runHaltsJob({ http: h.http, cfg: { now: () => NOW }, store, now: () => NOW });
    expect(run.status).toBe('ok');
    expect(run.rows_written).toBe(10);
    expect(log.halts[0]).toHaveLength(10);
    expect(run.details).toMatchObject({ halts: 10 });
    expect((run.details as { newsRelatedActive: number }).newsRelatedActive).toBeGreaterThanOrEqual(
      1,
    ); // the T1 halt
    expect(log.statuses[0]).toMatchObject({
      source: 'nasdaq_halts',
      state: 'live',
      planTier: 'real-time',
    });
    expect(log.runs).toEqual([run]);
  });

  it('sends a generic client name, never a personal identity', async () => {
    const { store } = fakeStore();
    const h = http(200, fixture.xml);
    await runHaltsJob({ http: h.http, cfg: { now: () => NOW }, store, now: () => NOW });
    expect(h.uas).toEqual(['Marsad-personal-research']);
  });

  it('treats an HTML error page served with HTTP 200 as an error, not as "no halts"', async () => {
    const { store, log } = fakeStore();
    const run = await runHaltsJob({
      http: http(200, '<html><body>Service unavailable</body></html>').http,
      cfg: { now: () => NOW },
      store,
      now: () => NOW,
    });
    expect(run.status).toBe('error');
    expect(run.error).toBe(
      'Halts feed unavailable: Nasdaq Trader returned data Marsad could not read (invalid-response)',
    );
    expect(log.halts).toEqual([]);
    expect(log.statuses).toEqual([]);
  });

  it('accepts a genuine empty feed (no halts yet) as ok with zero rows', async () => {
    const empty =
      '<rss version="2.0"><channel><pubDate>Tue, 24 Nov 2026 09:00:00 GMT</pubDate></channel></rss>';
    const { store, log } = fakeStore();
    const run = await runHaltsJob({
      http: http(200, empty).http,
      cfg: { now: () => NOW },
      store,
      now: () => NOW,
    });
    expect(run).toMatchObject({ status: 'ok', rows_written: 0 });
    expect(log.statuses[0]?.note).toBe('0 halts today, 0 active');
  });

  it('fails when items cannot be read, and does not mark the source live', async () => {
    const bad = `<rss><channel><pubDate>Tue, 24 Nov 2026 09:00:00 GMT</pubDate><item><title>X</title></item></channel></rss>`;
    const { store, log } = fakeStore();
    const run = await runHaltsJob({
      http: http(200, bad).http,
      cfg: { now: () => NOW },
      store,
      now: () => NOW,
    });
    expect(run.status).toBe('error');
    expect(run.error).toContain('1 unreadable items');
    expect(log.statuses).toEqual([]);
  });

  it('reports a server error with its own text', async () => {
    const { store } = fakeStore();
    const run = await runHaltsJob({
      http: http(503, 'down').http,
      cfg: { now: () => NOW },
      store,
      now: () => NOW,
    });
    expect(run.error).toBe(
      'Halts feed unavailable: Nasdaq Trader is having problems (server-error)',
    );
  });
});
