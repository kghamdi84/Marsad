import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import type { JobRunRecord } from '@marsad/core';
import { routedHttp } from './test-http.js';
import { runQualityJob, type QualityStore } from './quality-job.js';

const NOW = new Date('2026-11-25T09:41:00Z');
const dir = new URL('../../fixtures/sec/', import.meta.url).pathname;
const frameRoutes = readdirSync(dir)
  .filter((f) => f.startsWith('sec-frame-'))
  .map((f) => {
    const concept = f.slice(10).replace(/-CY.*$/, '');
    const body = (JSON.parse(readFileSync(dir + f, 'utf8')) as { body: unknown }).body;
    return [`/${concept}/`, { status: 200, body }] as const;
  });
const tickers = (
  JSON.parse(readFileSync(dir + 'sec-company-tickers.json', 'utf8')) as { body: unknown }
).body;
const sec = { userAgent: 'Marsad research test@example.com', now: () => NOW };

function memoryStore(universe: string[] | null) {
  const saved: { run: unknown; rows: unknown[] }[] = [];
  const runs: JobRunRecord[] = [];
  const store: QualityStore = {
    getLatestUniverse: () =>
      Promise.resolve(universe ? { monthStart: '2026-11-01', tickers: universe } : null),
    getLatestCloses: () =>
      Promise.resolve({
        date: '2026-11-24',
        closes: new Map([
          ['AAPL', 230],
          ['MSFT', 480],
          ['NVDA', 180],
          ['KO', 70],
          ['JNJ', 190],
          ['WMT', 100],
          ['PFE', 25],
          ['INTC', 35],
          ['F', 12],
          ['BAC', 50],
          ['T', 27],
        ]),
      }),
    saveQualityScreen: (run, rows) => {
      saved.push({ run, rows: [...rows] });
      return Promise.resolve(rows.length);
    },
    recordRun: (r) => {
      runs.push(r);
      return Promise.resolve();
    },
  };
  return { store, saved, runs };
}

const UNIVERSE = [
  'AAPL',
  'MSFT',
  'NVDA',
  'KO',
  'JNJ',
  'WMT',
  'PFE',
  'INTC',
  'F',
  'BAC',
  'T',
  'ZZZZ',
];

describe('runQualityJob on real SEC frames', () => {
  it('reads fiscal 2025 frames, counts every exclusion and publishes no ranking from 7 companies', async () => {
    const m = memoryStore(UNIVERSE);
    const { http, urls } = routedHttp(NOW, [
      ['company_tickers.json', { status: 200, body: tickers }],
      ...frameRoutes,
    ]);
    const run = await runQualityJob({ http, sec, store: m.store, now: () => NOW });
    expect(run.status).toBe('ok');
    expect(urls[0]).toBe('https://www.sec.gov/files/company_tickers.json');
    expect(urls).toContain(
      'https://data.sec.gov/api/xbrl/frames/us-gaap/GrossProfit/USD/CY2025.json',
    );
    expect(urls).toContain(
      'https://data.sec.gov/api/xbrl/frames/us-gaap/Assets/USD/CY2025Q4I.json',
    );
    expect(urls).toContain(
      'https://data.sec.gov/api/xbrl/frames/dei/EntityCommonStockSharesOutstanding/shares/CY2025Q4I.json',
    );
    // ZZZZ has no SEC CIK; BAC and T report no gross profit; INTC and F lost money in 2025.
    expect(m.saved[0]?.run).toEqual({
      asOf: '2026-11-25',
      version: 'quality-1',
      fiscalYear: 2025,
      priceDate: '2026-11-24',
      universe: 12,
      noCik: 1,
      eligible: 7,
      passed: 0,
      excluded: {
        'missing-data': 0,
        'no-gross-profit': 2,
        'not-profitable': 2,
        'negative-equity': 0,
        'no-price': 0,
      },
      insufficient: 'Only 7 companies have every input (at least 30 are needed for a ranking).',
    });
    expect(m.saved[0]?.rows).toEqual([]);
    expect(m.runs[0]?.job).toBe('quality-screen');
  });

  it('fails without storing anything when an SEC frame fails', async () => {
    const m = memoryStore(UNIVERSE);
    const { http } = routedHttp(NOW, [
      ['company_tickers.json', { status: 200, body: tickers }],
      ['/Liabilities/', { status: 500, body: 'oops' }],
      ...frameRoutes,
    ]);
    const run = await runQualityJob({ http, sec, store: m.store, now: () => NOW });
    expect(run.status).toBe('error');
    expect(run.error).toMatch(/^SEC frame Liabilities CY2025Q4I: /);
    expect(m.saved).toEqual([]);
  });

  it('finds the SEC record of a share class written with a dot (BRK.B is BRK-B at the SEC)', async () => {
    const m = memoryStore(['BRK.B']);
    const list = {
      ...(tickers as Record<string, unknown>),
      brk: { cik_str: 1067983, ticker: 'BRK-B', title: 'BERKSHIRE HATHAWAY INC' },
    };
    const { http } = routedHttp(NOW, [
      ['company_tickers.json', { status: 200, body: list }],
      ...frameRoutes,
    ]);
    await runQualityJob({ http, sec, store: m.store, now: () => NOW });
    expect((m.saved[0]?.run as { noCik: number }).noCik).toBe(0);
  });

  it('says so when no universe is stored yet', async () => {
    const m = memoryStore(null);
    const { http } = routedHttp(NOW, []);
    const run = await runQualityJob({ http, sec, store: m.store, now: () => NOW });
    expect(run.error).toBe('No Marsad universe is stored yet (the breadth job builds it).');
  });
});
