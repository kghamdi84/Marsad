import { describe, expect, it } from 'vitest';
import type { MassiveConfig } from '@marsad/core';
import { quarterSnapshotDates, runBreadthJob, weekdaysBetween } from './breadth-job.js';
import { fakeStore } from './fake-store.js';
import { routedHttp, type Reply } from './test-http.js';

// A synthetic market, served in the vendor's shapes through the real adapters. Prices are invented; the point is the
// job's bookkeeping: what it fetches, stores, skips and resumes.
const NOW = new Date('2026-11-25T12:00:00Z'); // 07:00 ET, so the last complete session is 2026-11-24
const cfg: MassiveConfig = { apiKey: 'k', planTier: 'end-of-day', now: () => NOW };
const HOLIDAY = '2026-07-03';
const SPLIT_DAY = '2026-08-17';
const CS = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'SPL', 'PEN'];
const ETF = ['E1', 'E2'];

function groupedFor(date: string): Reply {
  if (date === HOLIDAY)
    return { status: 200, body: { status: 'OK', resultsCount: 0, results: [] } };
  const k = Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse('2026-01-01T00:00:00Z')) / 86_400_000,
  );
  const rows = [...CS, ...ETF, 'W1'].map((t, j) => {
    let c = 50 + j * 10 + Math.sin(k / 7 + j) * 3 + k * 0.05;
    if (t === 'SPL' && date >= SPLIT_DAY) c /= 3; // a 3-for-1 split: raw prices drop to a third
    const v = t === 'PEN' ? 10_000 : 1_000_000 + j * 100_000; // PEN trades under USD 1 million a day
    return { T: t, c: Math.round(c * 100) / 100, v, o: c, h: c, l: c, t: 0, n: 1 };
  });
  return { status: 200, body: { status: 'DELAYED', adjusted: false, results: rows } };
}

function routes(failOn?: string) {
  return [
    [
      '/v2/aggs/grouped/',
      (url: string) => {
        const d = /stocks\/(\d{4}-\d{2}-\d{2})/.exec(url)?.[1] ?? '';
        return d === failOn ? { status: 429, body: { status: 'ERROR' } } : groupedFor(d);
      },
    ],
    [
      '/v3/reference/tickers',
      (url: string) => ({
        status: 200,
        body: {
          results: (url.includes('type=CS') ? CS : ETF).map((t) => ({
            ticker: t,
            type: url.includes('type=CS') ? 'CS' : 'ETF',
          })),
        },
      }),
    ],
    [
      '/stocks/v1/splits',
      {
        status: 200,
        body: {
          results: [
            {
              id: 'Esplit1',
              ticker: 'SPL',
              execution_date: SPLIT_DAY,
              split_from: 1,
              split_to: 3,
              adjustment_type: 'forward_split',
            },
          ],
        },
      },
    ],
  ] as const;
}

describe('dates the job works with', () => {
  it('weekdays only, up to but not including the end', () => {
    expect(weekdaysBetween('2026-11-20', '2026-11-25')).toEqual([
      '2026-11-20',
      '2026-11-23',
      '2026-11-24',
    ]);
  });
  it('one ticker list per quarter, starting with the last one on or before the start', () => {
    expect(quarterSnapshotDates('2026-05-09', '2026-11-24')).toEqual([
      '2026-04-02',
      '2026-07-02',
      '2026-10-02',
    ]);
    // January 2 2027 is a Saturday: the list is taken on Monday the 4th.
    expect(quarterSnapshotDates('2026-12-01', '2027-02-01')).toEqual(['2026-10-02', '2027-01-04']);
  });
});

describe('runBreadthJob', () => {
  it('fetches every missing session once, stores the universe and breadth, and marks the source live', async () => {
    const { store, log } = fakeStore();
    const { http, urls } = routedHttp(NOW, routes());
    const run = await runBreadthJob({
      http,
      cfg,
      store,
      now: () => NOW,
      historyDays: 200,
      universeSize: 5,
    });
    expect(run.status).toBe('ok');
    const sessions = weekdaysBetween('2026-05-09', '2026-11-25');
    expect(log.snapshotsSaved).toEqual(sessions); // 2026-05-09 is 200 days before 2026-11-25
    expect(run.details).toMatchObject({
      fetched: sessions.length,
      closed: 1,
      sessions: sessions.length - 1,
    });
    // One ticker list per quarter (CS and ETF), and the split history once.
    expect(urls.filter((u) => u.includes('/v3/reference/tickers'))).toHaveLength(6);
    expect(urls.filter((u) => u.includes('/stocks/v1/splits'))).toHaveLength(1);
    // The universe: the 5 largest by dollar volume among common stocks and ETFs. The warrant W1 is not eligible and
    // PEN is never stored (under USD 1 million a day).
    const months = log.universe[0]?.rows ?? [];
    expect(months.length).toBeGreaterThan(0);
    expect(months.some((m) => m.ticker === 'W1' || m.ticker === 'PEN')).toBe(false);
    // July to November: June has only 15 sessions before it (the window starts on 2026-05-09), and 20 are needed.
    expect(new Set(months.map((m) => m.monthStart)).size).toBe(5);
    // The 3-for-1 split is adjusted, so it is never mistaken for a 67% crash.
    const days = log.breadth[0] ?? [];
    expect(days.reduce((s, d) => s + d.suspect, 0)).toBe(0);
    expect(log.statuses[0]).toMatchObject({ source: 'massive_breadth', state: 'live' });
  });

  it('a second run fetches nothing it already has: only the recent splits again', async () => {
    const { store } = fakeStore();
    await runBreadthJob({
      http: routedHttp(NOW, routes()).http,
      cfg,
      store,
      now: () => NOW,
      historyDays: 200,
      universeSize: 5,
    });
    const second = routedHttp(NOW, routes());
    const run = await runBreadthJob({
      http: second.http,
      cfg,
      store,
      now: () => NOW,
      historyDays: 200,
      universeSize: 5,
    });
    expect(run.status).toBe('ok');
    expect(run.details).toMatchObject({ fetched: 0 });
    expect(second.urls).toHaveLength(1);
    expect(second.urls[0]).toContain(`execution_date.gte=2026-08-03`); // 14 days before the latest known split
  });

  it('stops at a failed session, keeps what it stored, and the next run continues from there', async () => {
    const { store, log } = fakeStore();
    const failing = routedHttp(NOW, routes('2026-06-01'));
    const run = await runBreadthJob({
      http: failing.http,
      cfg,
      store,
      now: () => NOW,
      historyDays: 200,
      universeSize: 5,
    });
    expect(run.status).toBe('error');
    expect(run.error).toContain('grouped 2026-06-01');
    expect(run.error).toContain('the next run continues');
    expect(log.snapshotsSaved.at(-1)).toBe('2026-05-29');
    expect(log.statuses).toEqual([]);
    const next = routedHttp(NOW, routes());
    const again = await runBreadthJob({
      http: next.http,
      cfg,
      store,
      now: () => NOW,
      historyDays: 200,
      universeSize: 5,
    });
    expect(again.status).toBe('ok');
    expect(next.urls[0]).toContain('/stocks/2026-06-01?adjusted=false');
  });

  it('caps the sessions fetched in one run', async () => {
    const { store } = fakeStore();
    const run = await runBreadthJob({
      http: routedHttp(NOW, routes()).http,
      cfg,
      store,
      now: () => NOW,
      historyDays: 200,
      universeSize: 5,
      maxNewSessions: 10,
    });
    expect(run.details).toMatchObject({ fetched: 10 });
  });
});
