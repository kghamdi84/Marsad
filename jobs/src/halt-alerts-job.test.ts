import { describe, expect, it } from 'vitest';
import { fakeStore } from './fake-store.js';
import { runHaltAlertsJob } from './halt-alerts-job.js';

const NOW = new Date('2026-11-25T19:35:00Z');
const halts = [
  {
    symbol: 'SOFI',
    haltedAt: '2026-11-25T19:32:05.000Z',
    reasonCode: 'T1',
    reasonMeaning: 'News pending',
    newsRelated: true,
    resumptionTradeAt: '2026-11-25T19:47:00.000Z',
    lastSeenAt: '2026-11-25T19:34:30.000Z',
  },
  {
    symbol: 'ZZZZ',
    haltedAt: '2026-11-25T19:30:00.000Z',
    reasonCode: 'T1',
    reasonMeaning: 'News pending',
    newsRelated: true,
    resumptionTradeAt: null,
    lastSeenAt: '2026-11-25T19:34:30.000Z',
  },
];
const latestRows = {
  regime_daily: [{ date: '2026-11-24', label: 'stress' }],
  'fred_observations|series_id=VIXCLS': [{ date: '2026-11-24', value: 26.62 }],
};

describe('runHaltAlertsJob', () => {
  it('alerts on watched tickers only: the halt (critical) and the published resumption', async () => {
    const { store, log } = fakeStore({ halts, latestRows, watchlist: [] });
    const run = await runHaltAlertsJob({ store, now: () => NOW });
    expect(run.status).toBe('ok');
    const rows = log.storedAlerts[0] ?? [];
    expect(rows.map((r) => [r.input.ticker, r.input.eventId, r.decision])).toEqual([
      ['SOFI', 'halt:2026-11-25T19:32:05.000Z', 'push'],
      ['SOFI', 'resume:2026-11-25T19:47:00.000Z', 'push'],
    ]);
    expect(rows[0]?.input.priority).toBe('critical');
    expect(rows[0]?.input.context.regime).toBe('stress');
    expect(rows[0]?.push.title.length).toBeLessThanOrEqual(60);
    expect(rows[0]?.sourceAt).toBe('2026-11-25T19:34:30.000Z');
    expect(rows[0]?.delivery['push']).toContain('not-configured');
  });

  it('a saved watchlist adds tickers; a later run stores no duplicates', async () => {
    const first = fakeStore({ halts, latestRows, watchlist: ['ZZZZ'] });
    await runHaltAlertsJob({ store: first.store, now: () => NOW });
    const rows = first.log.storedAlerts[0] ?? [];
    expect(rows.map((r) => r.input.ticker)).toEqual(['SOFI', 'SOFI', 'ZZZZ']);
    const again = fakeStore({
      halts,
      latestRows,
      watchlist: ['ZZZZ'],
      recentAlerts: rows.map((r) => ({ key: r.key, at: r.createdAt, decision: r.decision })),
    });
    await runHaltAlertsJob({ store: again.store, now: () => new Date('2026-11-25T19:40:00Z') });
    expect(again.log.storedAlerts[0]).toEqual([]);
  });
});
