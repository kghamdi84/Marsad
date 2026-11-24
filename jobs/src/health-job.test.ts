import { describe, expect, it } from 'vitest';
import upcoming from '../../fixtures/massive/market-status-upcoming.json';
import { SOURCE_POLICY_VERSION, type UpcomingRow } from '@marsad/core';
import { fakeStore } from './fake-store.js';
import { runHealthJob } from './health-job.js';

const holidays = upcoming.data as UpcomingRow[];
const NOW = new Date('2026-11-24T20:46:00Z'); // Tuesday 15:46 ET, regular session
const ago = (sec: number) => new Date(NOW.getTime() - sec * 1000);
const beat = (source: string, sec: number | null) => ({
  source,
  lastMessageAt: sec === null ? null : ago(sec),
});
const healthy = [
  beat('massive', 20),
  beat('nasdaq_halts', 120),
  beat('sec_edgar', 900),
  beat('fred', 3600),
  beat('massive_reference', 3600),
  beat('massive_bars', 3600),
  beat('gpr', 3600),
];

describe('runHealthJob', () => {
  it('raises nothing and records an ok run when every source is healthy', async () => {
    const { store, log } = fakeStore({ heartbeats: healthy, holidays });
    const run = await runHealthJob({ store, now: () => NOW });
    expect(run.status).toBe('ok');
    expect(run.rows_written).toBe(0);
    expect(log.alerts).toEqual([]);
    expect(log.runs).toHaveLength(1);
    expect(log.runs[0]?.job).toBe('health-check');
  });

  it('raises one stale alert with the paused rules and a replayable snapshot', async () => {
    const stale = healthy.map((h) =>
      h.source === 'nasdaq_halts' ? beat('nasdaq_halts', 2400) : h,
    );
    const { store, log } = fakeStore({ heartbeats: stale, holidays });
    const run = await runHealthJob({ store, now: () => NOW });
    expect(run.status).toBe('ok');
    expect(run.details).toMatchObject({ stale: ['nasdaq_halts'], alerts: ['nasdaq_halts:stale'] });
    expect(log.alerts).toHaveLength(1);
    const a = log.alerts[0]!;
    expect(a.alert).toMatchObject({
      event: 'stale',
      source: 'nasdaq_halts',
      pausedRules: ['group:halts'],
    });
    expect(a.alert.headline).toContain('silent for');
    expect(a.alert.headline.length).toBeLessThanOrEqual(90);
    expect(a.policyVersion).toBe(SOURCE_POLICY_VERSION);
    expect(a.snapshot).toMatchObject({
      previousState: 'ok',
      health: { state: 'stale', session: 'regular', silenceSec: 2400 },
      maxSilenceSec: { regular: 1800 },
    });
  });

  it('does not alert again while the feed stays down', async () => {
    const stale = healthy.map((h) =>
      h.source === 'nasdaq_halts' ? beat('nasdaq_halts', 5400) : h,
    );
    const { store, log } = fakeStore({
      heartbeats: stale,
      holidays,
      health: { nasdaq_halts: 'stale' },
    });
    const run = await runHealthJob({ store, now: () => NOW });
    expect(run.status).toBe('ok');
    expect(run.rows_written).toBe(0);
    expect(log.alerts).toEqual([]);
  });

  it('raises a recovery alert when a stale feed speaks again', async () => {
    const { store, log } = fakeStore({
      heartbeats: healthy,
      holidays,
      health: { nasdaq_halts: 'stale' },
    });
    await runHealthJob({ store, now: () => NOW });
    expect(log.alerts.map((a) => [a.alert.source, a.alert.event])).toEqual([
      ['nasdaq_halts', 'recovered'],
    ]);
  });

  it('a source that has never reported raises nothing but is not called healthy', async () => {
    const { store, log } = fakeStore({
      heartbeats: healthy.filter((h) => h.source !== 'massive'),
      holidays,
    });
    const run = await runHealthJob({ store, now: () => NOW });
    expect(run.status).toBe('ok');
    expect(run.details).toMatchObject({ states: { never: 1 } });
    expect(log.alerts).toEqual([]);
  });

  it('fails loudly, after alerting on what it could judge, when the calendar does not cover today', async () => {
    const far = new Date('2030-01-15T15:00:00Z');
    const old = healthy.map((h) => ({ ...h, lastMessageAt: new Date(far.getTime() - 3600_000) }));
    const stale = old.map((h) =>
      h.source === 'gpr' ? { ...h, lastMessageAt: new Date(far.getTime() - 9 * 86_400_000) } : h,
    );
    const { store, log } = fakeStore({ heartbeats: stale, holidays });
    const run = await runHealthJob({ store, now: () => far });
    expect(run.status).toBe('error');
    expect(run.error).toMatch(/calendar does not cover today/);
    expect(run.error).toMatch(/massive, nasdaq_halts, sec_edgar/);
    expect(log.alerts.map((a) => [a.alert.source, a.alert.event])).toEqual([['gpr', 'stale']]);
    expect(log.runs).toHaveLength(1);
  });

  it('records a store failure as an error run instead of losing it', async () => {
    const { store, log } = fakeStore({ heartbeats: healthy, holidays });
    store.getSourceHeartbeats = () => Promise.reject(new Error('source_status read failed: boom'));
    const run = await runHealthJob({ store, now: () => NOW });
    expect(run.status).toBe('error');
    expect(run.error).toContain('boom');
    expect(log.runs).toHaveLength(1);
  });
});
