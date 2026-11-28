import { describe, expect, it } from 'vitest';
import holidays from '../../fixtures/massive/market-status-upcoming.json';
import aapl from '../../fixtures/tauric/research-AAPL-2026-11-28.json';
import {
  replayEarningsGuard,
  validateCalendar,
  type DailyBar,
  type HoldingRef,
  type UpcomingRow,
} from '@marsad/core';
import {
  runEarningsGuardJob,
  type EarningsGuardStore,
  type StoredEstimates,
} from './earnings-guard-job.js';
import { fakeStore, type FakeSeed } from './fake-store.js';
import type { StoredAlert } from './store.js';
import type { StoredResearchRow } from './ticker-summary-job.js';

// Saturday 2026-11-28, 11:45 UTC (14:45 Riyadh, outside the default quiet hours): after the research (09:35) and
// summary (11:25) jobs. The last completed session is Friday 2026-11-27.
const NOW = new Date('2026-11-28T11:45:00Z');

const bar = (date: string, close: number): DailyBar => ({
  date,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1_000_000,
  vwap: null,
});
const holding = (id: number, ticker: string, shares: number, stop: number | null): HoldingRef => ({
  id,
  ticker,
  shares,
  costBasis: 100,
  openedOn: '2026-10-01',
  stop,
  targets: stop === null ? [] : [300],
  trendBreak: null,
  timeStopSessions: null,
});

/** AAPL's recorded calendar with its earnings date moved into the window, stored as the research job stores it. */
function research(date: string, refreshedAt = '2026-11-28T00:31:21.418Z'): StoredResearchRow {
  const body = {
    ...aapl.parts.calendar.body,
    earnings: { ...aapl.parts.calendar.body.earnings, earnings_date: date },
    earnings_status: { ...aapl.parts.calendar.body.earnings_status, refreshed_at: refreshedAt },
  };
  const v = validateCalendar(body, 'AAPL');
  if (!v.ok) throw new Error(v.reason);
  return {
    ticker: 'AAPL',
    analyst: null,
    profile: null,
    calendar: v.value,
    analyst_refreshed_at: null,
    profile_refreshed_at: null,
    calendar_refreshed_at: refreshedAt,
    errors: {},
  };
}

const ESTIMATES: StoredEstimates = {
  computedAt: '2026-11-27T23:31:00.000Z',
  rows: [{ ticker: 'RKLB', date: '2026-12-02', from: '2026-11-25', to: '2026-12-09' }],
};

const seed: FakeSeed = {
  holidays: holidays.data as UpcomingRow[],
  latestRows: { regime_daily: [{ date: '2026-11-27', label: 'calm' }] },
  holdings: [
    holding(1, 'AAPL', 13, 160),
    holding(2, 'RKLB', 40, null),
    holding(3, 'SOFI', 100, 10),
  ],
  bars: {
    AAPL: [bar('2026-11-25', 172), bar('2026-11-27', 174.1)],
    RKLB: [bar('2026-11-25', 22), bar('2026-11-27', 23.5)],
    SOFI: [bar('2026-11-25', 12), bar('2026-11-27', 12.5)],
  },
  barsFetchedAt: {
    AAPL: '2026-11-27T22:35:00.000Z',
    RKLB: '2026-11-27T22:35:00.000Z',
    SOFI: '2026-11-27T22:35:00.000Z',
  },
};

function guardStore(
  over: FakeSeed = {},
  extra: {
    research?: StoredResearchRow[];
    estimates?: StoredEstimates | null;
    ruleAlerts?: { id: string; createdAt: string; eventId: string | null }[];
  } = {},
) {
  const { store, log } = fakeStore({ ...seed, ...over });
  const guard: EarningsGuardStore = {
    ...store,
    getResearch: (tickers) =>
      Promise.resolve(
        (extra.research ?? [research('2026-12-03')]).filter((r) => tickers.includes(r.ticker)),
      ),
    getEarningsEstimates: () =>
      Promise.resolve(extra.estimates === undefined ? ESTIMATES : extra.estimates),
    getRuleAlerts: (ruleId, since) =>
      Promise.resolve(
        ruleId === 'earnings-guard'
          ? (extra.ruleAlerts ?? []).filter((a) => a.createdAt >= since)
          : [],
      ),
  };
  return { store: guard, log };
}

const asRuleAlerts = (rows: readonly StoredAlert[]) =>
  rows.map((r, i) => ({ id: `id-${i}`, createdAt: r.createdAt, eventId: r.input.eventId ?? null }));

describe('runEarningsGuardJob', () => {
  it('alerts each holding within 5 sessions, lists the one with no date, and records the counts', async () => {
    const { store, log } = guardStore();
    const run = await runEarningsGuardJob({ store, now: () => NOW });
    expect(run).toMatchObject({ job: 'earnings-guard', status: 'ok', rows_written: 2 });
    expect(run.details).toMatchObject({
      version: 'earnings-guard-1',
      session: '2026-11-27',
      holdingsChecked: 3,
      alerts: 2,
      noDate: 1,
      deduped: 0,
      later: 0,
      noDateTickers: ['SOFI'],
      decisions: { push: 2 },
    });
    const rows = log.storedAlerts[0] ?? [];
    expect(rows.map((r) => [r.key, r.decision, r.sourceAt])).toEqual([
      ['earnings|AAPL|earnings-guard|earnings:1:2026-12-03', 'push', '2026-11-28T00:31:21.418Z'],
      ['earnings|RKLB|earnings-guard|earnings:2:2026-12-02', 'push', '2026-11-27T23:31:00.000Z'],
    ]);
    expect(rows[0]?.input.trigger).toBe(
      'AAPL reports in 4 sessions (Tauric date 2026-12-03). You hold 13 shares; stop 160.00, 8.1% below the close; exit rules set.',
    );
    expect(rows[1]?.input.trigger).toBe(
      'RKLB reports in 3 sessions (Marsad estimate 2026-12-02, estimated from past results filings, window 2026-11-25 to 2026-12-09). You hold 40 shares; no stop set; no exit rules set.',
    );
    expect(rows[0]?.input.context.regime).toBe('calm');
    expect(rows[0]?.delivery).toMatchObject({ push: 'pending', telegram: 'pending' });
    expect(rows[0]?.input.snapshot).toMatchObject({
      version: 'earnings-guard-1',
      session: '2026-11-27',
      holding: { id: 1, ticker: 'AAPL', shares: 13, stop: 160, hasExitRules: true },
      earnings: { date: '2026-12-03', source: 'tauric', asOf: '2026-11-28T00:31:21.418Z' },
      close: { date: '2026-11-27', close: 174.1 },
    });
    expect(log.runs.at(-1)?.job).toBe('earnings-guard');
  });

  it('replay reproduces every stored alert from its own snapshot', async () => {
    const { store, log } = guardStore();
    await runEarningsGuardJob({ store, now: () => NOW });
    const rows = log.storedAlerts[0] ?? [];
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      const stored = JSON.parse(JSON.stringify(r.input)) as typeof r.input;
      expect(replayEarningsGuard(stored)).toEqual(stored);
    }
  });

  it('a second run stores nothing new: one alert per holding per date, counted as deduped', async () => {
    const first = guardStore();
    await runEarningsGuardJob({ store: first.store, now: () => NOW });
    const stored = first.log.storedAlerts[0] ?? [];
    // Two sessions later, still inside the window, past the pipeline's 24-hour memory.
    const later = new Date('2026-12-01T11:45:00Z');
    const { store, log } = guardStore(
      { barsFetchedAt: { AAPL: '2026-11-30T22:35:00.000Z', RKLB: '2026-11-30T22:35:00.000Z' } },
      {
        research: [research('2026-12-03', '2026-12-01T00:31:21.418Z')],
        estimates: { ...ESTIMATES, computedAt: '2026-11-30T23:31:00.000Z' },
        ruleAlerts: asRuleAlerts(stored),
      },
    );
    const run = await runEarningsGuardJob({ store, now: () => later });
    expect(run).toMatchObject({ status: 'ok', rows_written: 0 });
    expect(run.details).toMatchObject({ deduped: 2, dedupedTickers: ['AAPL', 'RKLB'], alerts: 0 });
    expect(log.storedAlerts[0]).toEqual([]);
  });

  it('a changed date creates a new alert that refers to the earlier one', async () => {
    const first = guardStore();
    await runEarningsGuardJob({ store: first.store, now: () => NOW });
    const stored = first.log.storedAlerts[0] ?? [];
    const next = new Date('2026-11-29T11:45:00Z');
    const { store, log } = guardStore(
      {},
      {
        research: [research('2026-12-02', '2026-11-29T00:31:21.418Z')],
        ruleAlerts: asRuleAlerts(stored),
      },
    );
    const run = await runEarningsGuardJob({ store, now: () => next });
    expect(run.details).toMatchObject({ alerts: 1, deduped: 1, dedupedTickers: ['RKLB'] });
    const row = log.storedAlerts[0]?.[0];
    expect(row?.key).toBe('earnings|AAPL|earnings-guard|earnings:1:2026-12-02');
    expect(row?.input.trigger).toContain(
      `Date changed: the alert of 2026-11-28 11:45 UTC (06:45 ET) gave 2026-12-03.`,
    );
    expect(row?.input.snapshot).toMatchObject({
      previous: { alertId: 'id-0', date: '2026-12-03', createdAt: '2026-11-28T11:45:00.000Z' },
    });
  });

  it('uses the quiet hours saved in Settings (alert_preferences)', async () => {
    const { store, log } = guardStore({
      alertPreferences: { quietStart: '14:00', quietEnd: '15:00', dailyPushCap: 8 },
    });
    await runEarningsGuardJob({ store, now: () => NOW });
    const rows = log.storedAlerts[0] ?? [];
    expect(rows.map((r) => r.decision)).toEqual(['digest', 'digest']);
    expect(rows[0]?.reasons).toContain('quiet hours: to the digest');
    expect(rows[0]?.delivery).toMatchObject({ digest: 'pending' });
  });

  it('a date source older than a week is named and the run fails after storing the rest', async () => {
    const { store, log } = guardStore(
      {},
      { research: [research('2026-12-03', '2026-11-19T00:31:21.418Z')] },
    );
    const run = await runEarningsGuardJob({ store, now: () => NOW });
    expect(run.status).toBe('error');
    expect(run.error).toBe(
      'Earnings dates not checked for AAPL: Tauric calendar as of 2026-11-19T00:31:21.418Z, older than 7 days. 1 alert(s) stored for the rest.',
    );
    expect(log.storedAlerts[0]?.map((r) => r.input.ticker)).toEqual(['RKLB']);
    expect(log.runs.at(-1)).toMatchObject({ job: 'earnings-guard', status: 'error' });
  });

  it('no stored estimates and no research: every holding is reported as having no date', async () => {
    const { store, log } = guardStore({}, { research: [], estimates: null });
    const run = await runEarningsGuardJob({ store, now: () => NOW });
    expect(run).toMatchObject({ status: 'ok', rows_written: 0 });
    expect(run.details).toMatchObject({
      noDate: 3,
      noDateTickers: ['AAPL', 'RKLB', 'SOFI'],
      estimatesNote: 'no stored earnings estimates',
    });
    expect(log.storedAlerts[0]).toEqual([]);
  });

  it('no holdings is a clean run', async () => {
    const { store } = guardStore({ holdings: [] });
    const run = await runEarningsGuardJob({ store, now: () => NOW });
    expect(run).toMatchObject({ status: 'ok', rows_written: 0 });
    expect(run.details).toMatchObject({ holdingsChecked: 0, alerts: 0, noDate: 0, deduped: 0 });
  });
});
