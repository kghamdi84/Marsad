import { describe, expect, it } from 'vitest';
import { runExportsJob } from './exports-job.js';
import { fakeStore } from './fake-store.js';

describe('runExportsJob', () => {
  it('writes one folder per owner with only that owner’s personal rows and the shared rules', async () => {
    const { store, log } = fakeStore({
      exportTables: {
        trades: [
          { id: 1, owner_id: 'u1', ticker: 'RKLB' },
          { id: 2, owner_id: 'u2', ticker: 'SOFI' },
        ],
        holdings: [{ id: 5, owner_id: 'u1', ticker: 'NVDA' }],
        rules: [{ id: 'index-trend-filter', version: 1 }],
      },
    });
    const run = await runExportsJob({ store, now: () => new Date('2026-11-29T07:10:00Z') });
    expect(run.status).toBe('ok');
    expect(run.details).toMatchObject({ owners: 2, files: 22 }); // (10 tables + manifest) x 2 owners
    const u1 = log.uploads.filter((u) => u.path.startsWith('u1/2026-11-29/'));
    expect(JSON.parse(u1.find((u) => u.path.endsWith('/trades.json'))!.body)).toEqual([
      { id: 1, owner_id: 'u1', ticker: 'RKLB' },
    ]);
    expect(JSON.parse(u1.find((u) => u.path.endsWith('/rules.json'))!.body)).toHaveLength(1);
    const manifest = JSON.parse(u1.find((u) => u.path.endsWith('/manifest.json'))!.body);
    expect(manifest.tables.find((t: { name: string }) => t.name === 'holdings').rows).toBe(1);
    expect(log.uploads.some((u) => u.path.startsWith('u2/') && u.body.includes('RKLB'))).toBe(
      false,
    );
  });

  it('no personal rows: nothing to write, a clean run', async () => {
    const { store, log } = fakeStore({ exportTables: {} });
    expect(await runExportsJob({ store, now: () => new Date() })).toMatchObject({ status: 'ok' });
    expect(log.uploads).toEqual([]);
  });
});
