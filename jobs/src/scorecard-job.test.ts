import { describe, expect, it } from 'vitest';
import type { DailyBar, ScoredAlert } from '@marsad/core';
import { fakeStore } from './fake-store.js';
import { runScorecardJob } from './scorecard-job.js';

const bar = (date: string, close: number): DailyBar => ({
  date,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
  vwap: null,
});
const days = [
  '2026-11-16',
  '2026-11-17',
  '2026-11-18',
  '2026-11-19',
  '2026-11-20',
  '2026-11-23',
  '2026-11-24',
];
const NOW = new Date('2026-11-24T23:00:00Z');
const alert = (id: string, kind: string, ticker: string | null): ScoredAlert => ({
  id,
  createdAt: '2026-11-16T22:40:00.000Z',
  kind,
  ticker,
  ruleId: kind === 'exit' ? 'exit-stop' : 'halts',
  ruleStatus: 'live',
});

describe('runScorecardJob', () => {
  it('stores outcomes per horizon, skipping finished ones', async () => {
    const { store, log } = fakeStore({
      scoredAlerts: [alert('a1', 'exit', 'RKLB'), alert('a2', 'halt', 'SOFI')],
      finishedOutcomes: ['a2|1d', 'a2|5d', 'a2|20d'],
      bars: {
        RKLB: days.map((d, i) => bar(d, 20 - i)), // falls 1 a day: the exit was right
        SPY: days.map((d, i) => bar(d, 500 + i)),
      },
    });
    const run = await runScorecardJob({ store, now: () => NOW });
    expect(run.status).toBe('ok');
    const rows = log.outcomes[0] ?? [];
    expect(rows.map((o) => [o.alertId, o.horizon, o.status])).toEqual([
      ['a1', '1d', 'done'],
      ['a1', '5d', 'done'],
      ['a1', '20d', 'pending'],
    ]);
    // 1 session: 20 -> 19 is -5%, scored +5% for an exit.
    expect(rows[0]?.ret).toBeCloseTo(0.05, 12);
    expect(run.details).toMatchObject({ alerts: 2, states: { done: 2, pending: 1 } });
    expect(log.runs.at(-1)?.job).toBe('scorecard');
  });

  it('no alerts is a clean run', async () => {
    const { store } = fakeStore({ scoredAlerts: [] });
    expect(await runScorecardJob({ store, now: () => NOW })).toMatchObject({
      status: 'ok',
      rows_written: 0,
    });
  });
});
