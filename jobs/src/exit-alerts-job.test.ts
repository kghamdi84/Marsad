import { describe, expect, it } from 'vitest';
import holidays from '../../fixtures/massive/market-status-upcoming.json';
import type { DailyBar, HoldingRef, UpcomingRow } from '@marsad/core';
import { runExitAlertsJob } from './exit-alerts-job.js';
import { fakeStore } from './fake-store.js';

// Tuesday 2026-11-24, 22:40 UTC: the session closed at 21:00 UTC, so 2026-11-24 is the newest completed bar.
const NOW = new Date('2026-11-24T22:40:00Z');
const bar = (date: string, close: number): DailyBar => ({
  date,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1_000_000,
  vwap: null,
});
const holding = (id: number, ticker: string, stop: number): HoldingRef => ({
  id,
  ticker,
  shares: 100,
  costBasis: 24,
  openedOn: '2026-11-02',
  stop,
  targets: [30],
  trendBreak: null,
  timeStopSessions: null,
});
const seed = {
  holidays: holidays.data as UpcomingRow[],
  latestRows: { regime_daily: [{ date: '2026-11-24', label: 'stress' }] },
  barsFetchedAt: { RKLB: '2026-11-24T22:35:00.000Z', SOFI: '2026-11-24T22:36:00.000Z' },
};

describe('runExitAlertsJob', () => {
  it('stores one alert per newly broken rule, with the regime as context', async () => {
    const { store, log } = fakeStore({
      ...seed,
      holdings: [holding(1, 'RKLB', 22), holding(2, 'SOFI', 10)],
      bars: {
        RKLB: [bar('2026-11-23', 22.4), bar('2026-11-24', 21.8)],
        SOFI: [bar('2026-11-23', 12), bar('2026-11-24', 12.5)],
      },
    });
    const run = await runExitAlertsJob({ store, now: () => NOW });
    expect(run.status).toBe('ok');
    expect(run.details).toMatchObject({ holdings: 2, session: '2026-11-24', signals: 1 });
    const rows = log.storedAlerts[0] ?? [];
    expect(rows.map((r) => [r.input.ticker, r.key, r.decision, r.sourceAt])).toEqual([
      ['RKLB', 'exit|RKLB|exit-stop|exit:1:stop:2026-11-24', 'digest', '2026-11-24T22:35:00.000Z'],
    ]);
    expect(rows[0]?.input.context.regime).toBe('stress');
    expect(rows[0]?.reasons).toContain('quiet hours: to the digest');
  });

  it('uses the quiet hours and push cap saved in Settings (alert_preferences) instead of the defaults', async () => {
    const stored = async (prefs: {
      quietStart: string;
      quietEnd: string;
      dailyPushCap: number;
    }) => {
      const { store, log } = fakeStore({
        ...seed,
        alertPreferences: prefs,
        holdings: [holding(1, 'RKLB', 22)],
        bars: { RKLB: [bar('2026-11-23', 22.4), bar('2026-11-24', 21.8)] },
      });
      await runExitAlertsJob({ store, now: () => NOW });
      return log.storedAlerts[0]?.[0];
    };
    // The same run that is held by the default 23:00 to 07:00 is pushed when quiet hours are 12:00 to 13:00.
    const outside = await stored({ quietStart: '12:00', quietEnd: '13:00', dailyPushCap: 8 });
    expect(outside?.reasons).not.toContain('quiet hours: to the digest');
    // With a saved window that covers the run, it is held again.
    const inside = await stored({ quietStart: '00:00', quietEnd: '23:59', dailyPushCap: 8 });
    expect(inside?.decision).toBe('digest');
    expect(inside?.reasons).toContain('quiet hours: to the digest');
  });

  it('an event stored by an earlier run is not stored again', async () => {
    const { store, log } = fakeStore({
      ...seed,
      holdings: [holding(1, 'RKLB', 22)],
      bars: { RKLB: [bar('2026-11-23', 22.4), bar('2026-11-24', 21.8)] },
      recentAlerts: [
        {
          key: 'exit|RKLB|exit-stop|exit:1:stop:2026-11-24',
          at: '2026-11-24T22:20:00.000Z',
          decision: 'digest',
        },
      ],
    });
    await runExitAlertsJob({ store, now: () => NOW });
    expect(log.storedAlerts[0]).toEqual([]);
  });

  it('names holdings with missing or old bars and fails after storing the rest', async () => {
    const { store, log } = fakeStore({
      ...seed,
      holdings: [holding(1, 'RKLB', 22), holding(2, 'SOFI', 10), holding(3, 'ACME', 5)],
      bars: {
        RKLB: [bar('2026-11-23', 22.4), bar('2026-11-24', 21.8)],
        SOFI: [bar('2026-11-20', 12), bar('2026-11-21', 12.5)],
      },
    });
    const run = await runExitAlertsJob({ store, now: () => NOW });
    expect(run.status).toBe('error');
    expect(run.error).toBe(
      'Exit rules not checked for SOFI: newest bar 2026-11-21, expected 2026-11-24; ACME: no stored bars. 1 alert(s) stored for the rest.',
    );
    expect(log.storedAlerts[0]?.length).toBe(1);
    expect(log.runs.at(-1)?.job).toBe('alerts-exits');
  });

  it('no holdings is a clean run', async () => {
    const { store } = fakeStore({ ...seed, holdings: [] });
    const run = await runExitAlertsJob({ store, now: () => NOW });
    expect(run).toMatchObject({ status: 'ok', rows_written: 0 });
  });
});
