import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { HOLDERS_VERSION, type HolderList, type JobRunRecord } from '@marsad/core';
import { routedHttp } from './test-http.js';
import { runHoldersJob, type HoldersStore, type ThirteenFSource } from './holders-job.js';

const NOW = new Date('2026-11-29T09:45:00Z');
const sample = JSON.parse(
  readFileSync(new URL('../../fixtures/sec/13f/13f-sample.json', import.meta.url).pathname, 'utf8'),
) as { url: string; infotable: string[]; submission: string[]; coverpage: string[] };
const tickers = (
  JSON.parse(
    readFileSync(
      new URL('../../fixtures/sec/sec-company-tickers.json', import.meta.url).pathname,
      'utf8',
    ),
  ) as { body: Record<string, unknown> }
).body;
// The trimmed ticker list has NVIDIA; Rocket Lab is added as the SEC lists it.
const list = { ...tickers, rklb: { cik_str: 1819994, ticker: 'RKLB', title: 'Rocket Lab Corp' } };
const sec = { userAgent: 'Marsad research test@example.com', now: () => NOW };

const source = (urls = [sample.url]): ThirteenFSource & { downloads: string[] } => {
  const downloads: string[] = [];
  return {
    downloads,
    listDataSets: () => Promise.resolve(urls),
    download: (u) => {
      downloads.push(u);
      return Promise.resolve('fixture');
    },
    async *lines(_zip, file) {
      const lines =
        file === 'INFOTABLE.tsv'
          ? sample.infotable
          : file === 'SUBMISSION.tsv'
            ? sample.submission
            : sample.coverpage;
      for (const l of lines) yield l;
    },
  };
};

function memory(stored: { dataSet: string; version: string } | null = null) {
  const saved: { dataSet: string; lists: { ticker: string; list: HolderList }[] }[] = [];
  const runs: JobRunRecord[] = [];
  const store: HoldersStore = {
    getStoredDataSet: () => Promise.resolve(stored),
    saveHolders: (dataSet, lists) => {
      saved.push({ dataSet, lists: [...lists] });
      return Promise.resolve(lists.reduce((n, l) => n + l.list.top.length, 0));
    },
    recordRun: (r) => {
      runs.push(r);
      return Promise.resolve();
    },
  };
  return { store, saved, runs };
}

describe('runHoldersJob on the real 13F sample', () => {
  it('stores each company’s holders for the newest quarter, with the CUSIPs it used', async () => {
    const m = memory();
    const s = source();
    const { http } = routedHttp(NOW, [['company_tickers.json', { status: 200, body: list }]]);
    const run = await runHoldersJob({
      http,
      sec,
      source: s,
      store: m.store,
      now: () => NOW,
      tickers: ['NVDA', 'RKLB', 'ZZZZ'],
    });
    expect(run.status).toBe('ok');
    expect(s.downloads).toEqual([sample.url]);
    const saved = m.saved[0];
    expect(saved?.dataSet).toBe('01jun2026-31aug2026_form13f.zip');
    const nvda = saved?.lists.find((l) => l.ticker === 'NVDA')?.list;
    const rklb = saved?.lists.find((l) => l.ticker === 'RKLB')?.list;
    expect(nvda?.period).toBe('2026-06-30');
    expect(nvda?.cusips.map((c) => c.cusip)).toEqual(['67066G104']);
    expect(rklb?.cusips.map((c) => c.cusip).sort()).toEqual(['773121108', '773122106']);
    expect(nvda?.top.length).toBeGreaterThan(0);
    expect(nvda?.top[0]?.name).not.toBe('');
    expect(run.details).toMatchObject({ noHolders: [] });
  });

  it('skips a data set already stored, without downloading it', async () => {
    const m = memory({ dataSet: '01jun2026-31aug2026_form13f.zip', version: HOLDERS_VERSION });
    const s = source();
    const { http } = routedHttp(NOW, []);
    const run = await runHoldersJob({ http, sec, source: s, store: m.store, now: () => NOW });
    expect(run.status).toBe('skipped');
    expect(s.downloads).toEqual([]);
  });

  it('reads a stored data set again when it was counted under older rules', async () => {
    const m = memory({ dataSet: '01jun2026-31aug2026_form13f.zip', version: 'holders-1' });
    const s = source();
    const { http } = routedHttp(NOW, [['company_tickers.json', { status: 200, body: list }]]);
    const run = await runHoldersJob({ http, sec, source: s, store: m.store, now: () => NOW });
    expect(run.status).toBe('ok');
    expect(s.downloads).toHaveLength(1);
  });

  it('fails plainly when the SEC page lists no data set', async () => {
    const m = memory();
    const { http } = routedHttp(NOW, []);
    const run = await runHoldersJob({
      http,
      sec,
      source: source([]),
      store: m.store,
      now: () => NOW,
    });
    expect(run.error).toBe('No 13F data set link found on the SEC page');
  });
});
