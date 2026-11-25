import { describe, expect, it } from 'vitest';
import type { UpcomingRow } from '@marsad/core';
import holidays from '../../fixtures/massive/market-status-upcoming.json';
import { briefText, runBriefJob } from './brief-job.js';
import { fakeStore } from './fake-store.js';

const latestRows = {
  regime_daily: [{ date: '2026-11-24', label: 'stress', recession_level: 'elevated' }],
  fear_greed_daily: [
    { date: '2026-11-25', composite: null, label: null, available: 3 },
    { date: '2026-11-24', composite: 41.88, label: 'fear', available: 5 },
  ],
  capitulation_daily: [{ date: '2026-11-24', state: 'off' }],
  'fred_observations|series_id=VIXCLS': [{ date: '2026-11-24', value: 26.62 }],
  'fred_observations|series_id=VXVCLS': [{ date: '2026-11-24', value: 25.5 }],
  breadth_daily: [{ date: '2026-11-24', above50: 383, n50: 1000, above200: 521, n200: 1000 }],
  econ_calendar_snapshots: [
    {
      events: [
        {
          date: '2026-11-25',
          timeEt: '08:30',
          name: 'GDP',
          impact: 'high',
          kind: 'release',
          source: 'x',
        },
        {
          date: '2026-11-27',
          timeEt: '10:00',
          name: 'Later',
          impact: 'low',
          kind: 'release',
          source: 'x',
        },
      ],
    },
  ],
  earnings_estimate_snapshots: [
    {
      estimates: [
        { ticker: 'HIMS', date: '2026-11-30' },
        { ticker: 'NVDA', date: '2027-02-24' },
      ],
    },
  ],
  source_status: [
    { source: 'fred', state: 'live' },
    { source: 'massive_breadth', state: 'stale' },
  ],
  'daily_bars|ticker=NVDA': [
    { date: '2026-11-24', close: 104 },
    { date: '2026-11-21', close: 100 },
  ],
};
const seed = { holidays: holidays.data as UpcomingRow[], latestRows };

describe('runBriefJob', () => {
  it('builds the pre-market brief 60 minutes before the open and records email as not configured', async () => {
    // 2026-11-25 13:30 UTC is 08:30 EST, 60 minutes before the 09:30 open.
    const { store, log } = fakeStore(seed);
    const run = await runBriefJob({
      store,
      now: () => new Date('2026-11-25T13:30:00Z'),
      kind: 'pre-market',
      tickers: ['NVDA', 'NEWCO'],
    });
    expect(run.status).toBe('ok');
    const saved = log.briefs[0];
    expect(saved?.brief.title).toBe('Pre-market brief, Wed 2026-11-25');
    expect(saved?.delivery).toMatchObject({
      kind: 'pre-market',
      email: 'not-configured',
      push: 'pending',
      telegram: 'pending',
    });
    const lines = saved?.brief.sections.flatMap((s) => s.lines) ?? [];
    expect(lines).toContain('Fear and Greed composite 42, fear (5 of 7 components, 2026-11-24).');
    expect(lines).toContain('08:30 ET GDP (high impact).');
    expect(lines).toContain('NVDA +4.0% (2026-11-24).');
    expect(lines).toContain(
      'Estimated earnings this week: HIMS around 2026-11-30 (estimates, not confirmed).',
    );
    expect(lines).toContain('System health: stale or unavailable: massive_breadth.');
    // The inputs are stored with the brief, so it can be rebuilt.
    expect(saved?.inputs).toMatchObject({ date: '2026-11-25', vix: { value: 26.62 } });
  });

  it('skips outside its window and on holidays', async () => {
    const early = await runBriefJob({
      store: fakeStore(seed).store,
      now: () => new Date('2026-11-25T12:30:00Z'), // 120 minutes before the open in winter time
      kind: 'pre-market',
    });
    expect(early.details).toMatchObject({ skipped: expect.stringContaining('120 minutes') });
    const thanksgiving = await runBriefJob({
      store: fakeStore(seed).store,
      now: () => new Date('2026-11-26T13:30:00Z'),
      kind: 'pre-market',
    });
    expect(thanksgiving.details).toMatchObject({ skipped: '2026-11-26 is not a trading day' });
  });

  it('the recap lists the next session, past the holiday, and sends the email once', async () => {
    const sent: string[] = [];
    const { store, log } = fakeStore(seed);
    const run = await runBriefJob({
      store,
      now: () => new Date('2026-11-25T22:50:00Z'),
      kind: 'close-recap',
      tickers: ['NVDA'],
      sendEmail: (subject, text) => {
        sent.push(`${subject}\n${text}`);
        return Promise.resolve();
      },
    });
    expect(run.status).toBe('ok');
    // Thanksgiving (2026-11-26) is closed, so the next session is 2026-11-27.
    expect(log.briefs[0]?.brief.sections[2]?.lines).toEqual(['10:00 ET Later.']);
    expect(log.briefs[0]?.delivery).toMatchObject({ email: 'sent' });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('you decide and place every order in Sahm');
  });

  it('a failed email keeps the brief and fails the run', async () => {
    const { store, log } = fakeStore(seed);
    const run = await runBriefJob({
      store,
      now: () => new Date('2026-11-25T22:50:00Z'),
      kind: 'close-recap',
      tickers: [],
      sendEmail: () => Promise.reject(new Error('Resend answered 403')),
    });
    expect(run.status).toBe('error');
    expect(log.briefs[0]?.delivery['email']).toBe('failed: Resend answered 403');
  });

  it('does not email a brief already sent today', async () => {
    let calls = 0;
    const { store } = fakeStore({
      ...seed,
      latestRows: {
        ...latestRows,
        'briefs|for_date=2026-11-25': [{ delivery: { kind: 'close-recap', email: 'sent' } }],
      },
    });
    await runBriefJob({
      store,
      now: () => new Date('2026-11-25T22:55:00Z'),
      kind: 'close-recap',
      tickers: [],
      sendEmail: () => {
        calls += 1;
        return Promise.resolve();
      },
    });
    expect(calls).toBe(0);
  });

  it('a rerun keeps the recorded push state, so the same brief is never pushed twice', async () => {
    const { store, log } = fakeStore({
      ...seed,
      latestRows: {
        ...latestRows,
        'briefs|for_date=2026-11-25': [
          { delivery: { kind: 'close-recap', email: 'sent', push: 'sent to 1 of 1 device' } },
        ],
      },
    });
    await runBriefJob({
      store,
      now: () => new Date('2026-11-25T22:55:00Z'),
      kind: 'close-recap',
      tickers: [],
    });
    expect(log.briefs[0]?.delivery['push']).toBe('sent to 1 of 1 device');
    // Stored before Telegram existed: never sent late as if new.
    expect(log.briefs[0]?.delivery['telegram']).toBe('not sent (brief stored before Telegram)');
  });

  it('briefText has no em dash', () => {
    const text = briefText({
      kind: 'pre-market',
      date: '2026-11-25',
      version: 'brief-1',
      title: 'T',
      pushBody: 'P',
      sections: [{ heading: 'H', lines: ['a', 'b'] }],
    });
    expect(text).toContain('H\n- a\n- b');
    expect(text).not.toMatch(/—/);
  });
});
