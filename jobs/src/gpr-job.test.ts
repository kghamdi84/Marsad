import { describe, expect, it } from 'vitest';
import type { GprDay, JobRunRecord } from '@marsad/core';
import { runGprJob } from './gpr-job.js';
import type { SourceStatusUpdate, Store } from './store.js';

function fakeStore() {
  const log = {
    upserts: [] as GprDay[][],
    runs: [] as JobRunRecord[],
    statuses: [] as SourceStatusUpdate[],
  };
  const store: Store = {
    upsertGprDays: (days) => {
      log.upserts.push([...days]);
      return Promise.resolve(days.length);
    },
    upsertFredObservations: () => Promise.resolve(0),
    recordRun: (run) => {
      log.runs.push(run);
      return Promise.resolve();
    },
    updateSourceStatus: (u) => {
      log.statuses.push(u);
      return Promise.resolve();
    },
  };
  return { store, log };
}

/** n daily rows ending 2026-11-23, in the converter's output shape. */
function rows(n: number): Record<string, unknown>[] {
  const end = Date.parse('2026-11-23T00:00:00Z');
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(end - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10),
    GPRD: 100 + (i % 50),
    GPRD_ACT: 90,
    GPRD_THREAT: 110,
    GPRD_MA7: 100,
    GPRD_MA30: 100,
  }));
}

const clock = () => {
  let t = Date.parse('2026-11-23T20:00:00Z');
  return () => new Date((t += 500));
};

describe('runGprJob', () => {
  it('stores the rows, records an ok run and marks the source live', async () => {
    const { store, log } = fakeStore();
    const run = await runGprJob({
      store,
      now: clock(),
      download: () => Promise.resolve(new Uint8Array(5000)),
      convert: () => Promise.resolve(rows(1500)),
    });
    expect(run).toMatchObject({ job: 'gpr-daily', status: 'ok', rows_written: 1500, error: null });
    expect(run.details).toMatchObject({ latest: '2026-11-23', skippedRows: 0, fileBytes: 5000 });
    expect(log.runs).toEqual([run]);
    expect(log.statuses).toHaveLength(1);
    expect(log.statuses[0]).toMatchObject({
      source: 'gpr',
      planTier: 'end-of-day',
      state: 'live',
      note: 'Latest value 2026-11-23',
    });
  });

  it('records an error run and leaves the source status untouched when the download fails', async () => {
    const { store, log } = fakeStore();
    const run = await runGprJob({
      store,
      now: clock(),
      download: () => Promise.reject(new Error('GPR download failed: HTTP 503')),
      convert: () => Promise.resolve([]),
    });
    expect(run).toMatchObject({ status: 'error', error: 'GPR download failed: HTTP 503' });
    expect(log.runs).toHaveLength(1);
    expect(log.upserts).toEqual([]);
    expect(log.statuses).toEqual([]);
  });

  it('refuses a truncated file instead of overwriting good data', async () => {
    const { store, log } = fakeStore();
    const run = await runGprJob({
      store,
      now: clock(),
      download: () => Promise.resolve(new Uint8Array(5000)),
      convert: () => Promise.resolve(rows(40)),
    });
    expect(run.status).toBe('error');
    expect(run.error).toContain('only 40 valid rows');
    expect(log.upserts).toEqual([]);
  });

  it('refuses an empty or tiny download', async () => {
    const { store } = fakeStore();
    const run = await runGprJob({
      store,
      now: clock(),
      download: () => Promise.resolve(new Uint8Array(10)),
      convert: () => Promise.resolve(rows(1500)),
    });
    expect(run.status).toBe('error');
    expect(run.error).toContain('download too small');
  });

  it('counts skipped rows but still stores the valid ones', async () => {
    const { store } = fakeStore();
    const bad = [...rows(1500), { date: 'nope', GPRD: 1, GPRD_ACT: 1, GPRD_THREAT: 1 }];
    const run = await runGprJob({
      store,
      now: clock(),
      download: () => Promise.resolve(new Uint8Array(5000)),
      convert: () => Promise.resolve(bad),
    });
    expect(run.status).toBe('ok');
    expect(run.details).toMatchObject({ skippedRows: 1 });
  });
});
