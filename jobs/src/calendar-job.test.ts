import { describe, expect, it } from 'vitest';
import releaseDates from '../../fixtures/fred/fred-release-dates-2026-11-25.json';
import { runCalendarJob } from './calendar-job.js';
import { fakeStore } from './fake-store.js';
import { routedHttp } from './test-http.js';

const NOW = new Date('2026-11-25T23:40:00Z');
const page1 = releaseDates.body as { count: number; release_dates: unknown[] };
const NVDA = '0001045810';
const history = [
  '2025-02-26',
  '2025-05-28',
  '2025-08-27',
  '2025-11-19',
  '2026-02-25',
  '2026-05-27',
  '2026-08-26',
  '2026-11-17',
];

function http(status = 200) {
  return routedHttp(NOW, [
    [
      '/fred/releases/dates',
      (url: string) =>
        status !== 200
          ? { status, body: { error_message: 'Bad Request' } }
          : url.includes('offset=1000')
            ? { status: 200, body: { count: 1040, release_dates: [] } }
            : { status: 200, body: page1 },
    ],
  ]);
}

describe('runCalendarJob', () => {
  it('stores the next 60 days of events and an estimate per company with results filings', async () => {
    const { http: h, urls } = http();
    const { store, log } = fakeStore({
      instruments: [
        { cik: NVDA, ticker: 'NVDA' },
        { cik: '0000000001', ticker: 'NEWCO' },
      ],
      resultsFilings: history.map((date) => ({ cik: NVDA, date })),
    });
    const run = await runCalendarJob({
      http: h,
      fred: { apiKey: 'fred-key', now: () => NOW },
      store,
      now: () => NOW,
    });
    expect(run.status).toBe('ok');
    const cal = log.econCalendars[0];
    expect(cal).toMatchObject({ from: '2026-11-25', to: '2027-01-24' });
    expect(cal?.events[0]?.date).toBe('2026-11-25');
    expect(cal?.events.some((e) => e.date === '2026-12-09' && e.kind === 'fomc')).toBe(true);
    // The 2027-01-27 FOMC statement is past the 60-day window.
    expect(cal?.events.some((e) => e.date === '2027-01-27')).toBe(false);
    expect(log.earningsEstimates[0]).toEqual([
      expect.objectContaining({
        ticker: 'NVDA',
        date: '2027-02-24',
        basis: 'same-quarter-last-year',
      }),
    ]);
    expect(run.details).toMatchObject({ estimates: 1, withoutHistory: 1 });
    expect(urls.every((u) => !u.includes('fred-key') || u.includes('api_key=fred-key'))).toBe(true);
  });

  it('fails loudly when FRED refuses, and stores nothing', async () => {
    const { http: h } = http(400);
    const { store, log } = fakeStore({ instruments: [] });
    const run = await runCalendarJob({
      http: h,
      fred: { apiKey: 'fred-key', now: () => NOW },
      store,
      now: () => NOW,
    });
    expect(run.status).toBe('error');
    expect(run.error).toContain('FRED release dates');
    expect(run.error).not.toContain('fred-key');
    expect(log.econCalendars).toHaveLength(0);
  });
});
