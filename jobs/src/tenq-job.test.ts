import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { JobRunRecord } from '@marsad/core';
import { routedHttp } from './test-http.js';
import { runTenQJob, type TenQFiling, type TenQStore } from './tenq-job.js';

const NOW = new Date('2026-11-25T12:00:00Z');
const dir = new URL('../../fixtures/sec/10q/', import.meta.url).pathname;
const html = (name: string) =>
  gunzipSync(
    Buffer.from(
      (JSON.parse(readFileSync(dir + name, 'utf8')) as { gzipBase64: string }).gzipBase64,
      'base64',
    ),
  ).toString('utf8');

const filing = (acc: string, doc: string, date: string): TenQFiling => ({
  accession: acc,
  cik: '0001819994',
  ticker: 'RKLB',
  filingDate: date,
  periodEnd: null,
  primaryDocument: doc,
});
const newer = filing('0001819994-26-000074', 'rklb-20260930.htm', '2026-11-09');
const older = filing('0001819994-26-000062', 'rklb-20260630.htm', '2026-08-10');

function memory(have: string[] = []) {
  const saved: unknown[] = [];
  const runs: JobRunRecord[] = [];
  const store: TenQStore = {
    getRecentTenQ: () => Promise.resolve([newer, older]),
    getStoredQuarterly: () => Promise.resolve(new Set(have)),
    saveQuarterly: (rows) => {
      saved.push(...rows);
      return Promise.resolve(rows.length);
    },
    recordRun: (r) => {
      runs.push(r);
      return Promise.resolve();
    },
  };
  return { store, saved, runs };
}
const sec = { userAgent: 'Marsad research test@example.com', now: () => NOW };

describe('runTenQJob on two real Rocket Lab 10-Qs', () => {
  it('downloads each new filing once and stores Part II, Item 1A as filed', async () => {
    const m = memory();
    const { http, urls } = routedHttp(NOW, [
      ['rklb-20260930.htm', { status: 200, body: html('10q-RKLB-0001819994-26-000074.json') }],
      ['rklb-20260630.htm', { status: 200, body: html('10q-RKLB-0001819994-26-000062.json') }],
    ]);
    const run = await runTenQJob({ http, sec, store: m.store, now: () => NOW });
    expect(run.status).toBe('ok');
    expect(urls).toEqual([
      'https://www.sec.gov/Archives/edgar/data/1819994/000181999426000074/rklb-20260930.htm',
      'https://www.sec.gov/Archives/edgar/data/1819994/000181999426000062/rklb-20260630.htm',
    ]);
    const rows = m.saved as { accession: string; text: string; noMaterialChanges: boolean }[];
    expect(rows.map((r) => [r.accession, r.text.length, r.noMaterialChanges])).toEqual([
      ['0001819994-26-000074', 4175, false],
      ['0001819994-26-000062', 21619, false],
    ]);
    expect(
      rows[0]?.text.startsWith(
        'Other than as set forth below, there have been no material changes',
      ),
    ).toBe(true);
    expect(rows[1]?.text).toContain('Iridium Transaction');
  });

  it('skips filings already stored', async () => {
    const m = memory(['0001819994-26-000074', '0001819994-26-000062']);
    const { http, urls } = routedHttp(NOW, []);
    const run = await runTenQJob({ http, sec, store: m.store, now: () => NOW });
    expect(urls).toEqual([]);
    expect(run.details).toMatchObject({ alreadyStored: 2, stored: 0 });
  });

  it('names a filing whose section it cannot find and stores nothing for it; a failed download fails the run', async () => {
    const m = memory();
    const { http } = routedHttp(NOW, [
      [
        'rklb-20260930.htm',
        { status: 200, body: '<html><body>No risk factor section here.</body></html>' },
      ],
      ['rklb-20260630.htm', { status: 404, body: 'gone' }],
    ]);
    const run = await runTenQJob({ http, sec, store: m.store, now: () => NOW });
    expect(run.status).toBe('error');
    expect(run.error).toMatch(/^10-Q downloads failed: RKLB 0001819994-26-000062/);
    expect(m.saved).toEqual([]);
  });
});
