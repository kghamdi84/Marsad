import { describe, expect, it } from 'vitest';
import type { MassiveConfig } from '@marsad/core';
import sample from '../../fixtures/massive/news-market-sample-2026-11-24.json';
import { fakeStore } from './fake-store.js';
import { routedHttp } from './test-http.js';
import { runTopicsJob } from './topics-job.js';

const NOW = new Date('2026-11-25T01:20:00Z');
const cfg: MassiveConfig = { apiKey: 'k', planTier: 'end-of-day', now: () => NOW };
const articles = sample.body.results;

/** Every day serves the 23 real sample articles, split over two pages for 2026-11-24. */
function routes(failOn?: string) {
  return [
    [
      '/v2/reference/news',
      (url: string) => {
        const d = /gte=(\d{4}-\d{2}-\d{2})/.exec(url)?.[1] ?? '';
        if (d === failOn) return { status: 503, body: { status: 'ERROR' } };
        if (url.includes('cursor=p2'))
          return { status: 200, body: { status: 'OK', results: articles.slice(12) } };
        if (d === '2026-11-24')
          return {
            status: 200,
            body: {
              status: 'OK',
              results: articles.slice(0, 12),
              next_url: 'https://api.massive.com/v2/reference/news?cursor=p2&apiKey=secret',
            },
          };
        return { status: 200, body: { status: 'OK', results: articles } };
      },
    ],
  ] as const;
}

describe('runTopicsJob', () => {
  it('fills the 35-day window, one row per complete UTC day, following pages', async () => {
    const { http, urls } = routedHttp(NOW, routes());
    const { store, log } = fakeStore({ topicDates: [] });
    const run = await runTopicsJob({ http, cfg, store, now: () => NOW });
    expect(run.status).toBe('ok');
    const rows = log.topicDays[0] ?? [];
    expect(rows).toHaveLength(35);
    expect(rows[0]?.date).toBe('2026-10-21');
    expect(rows.at(-1)?.date).toBe('2026-11-24');
    // Today (2026-11-25) is not complete, so it is not fetched.
    expect(urls.some((u) => u.includes('gte=2026-11-25'))).toBe(false);
    // The two pages of 2026-11-24 make one day of 23 articles, counted as the hand labels say.
    expect(rows.at(-1)).toMatchObject({
      total: 23,
      counts: { tariffs: 4, energy: 3, centralBanks: 2 },
    });
    // The next page is requested without the key the vendor put in next_url.
    expect(urls.filter((u) => u.includes('cursor=p2'))).toHaveLength(1);
    expect(urls.some((u) => u.includes('apiKey=secret'))).toBe(false);
    expect(log.statuses.at(-1)).toMatchObject({ source: 'massive_topics', state: 'live' });
  });

  it('fetches only missing days plus the last two again', async () => {
    const stored: string[] = [];
    for (let i = 0; i < 35; i++)
      stored.push(new Date(Date.UTC(2026, 9, 21 + i)).toISOString().slice(0, 10));
    const { http } = routedHttp(NOW, routes());
    const { store, log } = fakeStore({ topicDates: stored.filter((d) => d !== '2026-11-10') });
    await runTopicsJob({ http, cfg, store, now: () => NOW });
    expect((log.topicDays[0] ?? []).map((r) => r.date)).toEqual([
      '2026-11-10',
      '2026-11-23',
      '2026-11-24',
    ]);
  });

  it('keeps the days it got and names the day that failed', async () => {
    const { http } = routedHttp(NOW, routes('2026-11-20'));
    const { store, log } = fakeStore({ topicDates: [] });
    const run = await runTopicsJob({ http, cfg, store, now: () => NOW });
    expect(run.status).toBe('error');
    expect(run.error).toContain('2026-11-20');
    expect(log.topicDays[0]).toHaveLength(34);
  });
});
