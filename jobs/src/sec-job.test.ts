import { describe, expect, it } from 'vitest';
import { HttpClient, TokenBucket, type Clock, type FetchLike, type SecConfig } from '@marsad/core';
import { fakeStore } from './fake-store.js';
import { runSecJob } from './sec-job.js';

const NOW = new Date('2026-11-24T14:07:00Z');
const cfg: SecConfig = { userAgent: 'Marsad research test@example.com', now: () => NOW };

// SYNTHETIC bodies in the SEC's documented shapes (not recorded from the live service).
const tickers = {
  '0': { cik_str: 1045810, ticker: 'NVDA', title: 'NVIDIA CORP' },
  '1': { cik_str: 1919011, ticker: 'RKLB', title: 'Rocket Lab Corp' },
  '2': { cik_str: 1919011, ticker: 'RKLB', title: 'Duplicate row, ignored' },
};
const submissions = (acc: string) =>
  JSON.stringify({
    filings: {
      recent: {
        accessionNumber: [acc],
        form: ['8-K'],
        filingDate: ['2026-11-20'],
        acceptanceDateTime: ['2026-11-20T21:05:11.000Z'],
        primaryDocument: ['x8k.htm'],
        items: ['2.02,9.01'],
      },
    },
  });

function http(opts: { failCik?: string; tickerStatus?: number } = {}): {
  http: HttpClient;
  urls: string[];
  uas: (string | undefined)[];
} {
  const urls: string[] = [];
  const uas: (string | undefined)[] = [];
  const clock: Clock = { now: () => NOW.getTime(), sleep: () => Promise.resolve() };
  const fetch: FetchLike = (url, init) => {
    urls.push(url);
    uas.push(init?.headers?.['User-Agent']);
    let status = 200;
    let body = '{}';
    if (url.endsWith('/files/company_tickers.json')) {
      status = opts.tickerStatus ?? 200;
      body = JSON.stringify(tickers);
    } else if (url.includes('/submissions/CIK')) {
      if (opts.failCik && url.includes(opts.failCik)) status = 500;
      body = submissions(url.includes('1045810') ? '0001045810-26-000100' : '0001919011-26-000010');
    }
    return Promise.resolve({
      status,
      headers: { get: () => null },
      text: () => Promise.resolve(body),
    });
  };
  return {
    http: new HttpClient({ fetch, clock, bucket: new TokenBucket(100, 100, clock), maxRetries: 0 }),
    urls,
    uas,
  };
}

describe('runSecJob (SYNTHETIC SEC bodies)', () => {
  it('stores instruments and filings, declares the User-Agent on every request, and marks the source live', async () => {
    const { store, log } = fakeStore();
    const h = http();
    const run = await runSecJob({
      http: h.http,
      cfg,
      store,
      now: () => NOW,
      tickers: ['NVDA', 'RKLB'],
    });
    expect(run.status).toBe('ok');
    expect(log.instruments[0]?.map((c) => c.cik)).toEqual(['0001045810', '0001919011']);
    expect(log.filings).toEqual([
      { cik: '0001045810', n: 1 },
      { cik: '0001919011', n: 1 },
    ]);
    expect(h.uas.every((u) => u === 'Marsad research test@example.com')).toBe(true);
    expect(log.statuses[0]).toMatchObject({
      source: 'sec_edgar',
      state: 'live',
      note: 'Recent filings for 2 companies',
    });
  });

  it('names a ticker with no CIK and does not mark the source live', async () => {
    const { store, log } = fakeStore();
    const run = await runSecJob({
      http: http().http,
      cfg,
      store,
      now: () => NOW,
      tickers: ['NVDA', 'ZZZZ'],
    });
    expect(run.status).toBe('error');
    expect(run.error).toContain('ZZZZ: no CIK in the SEC ticker file');
    expect(log.filings).toHaveLength(1);
    expect(log.statuses).toEqual([]);
  });

  it('names a company whose filings failed, keeping the others', async () => {
    const { store, log } = fakeStore();
    const run = await runSecJob({
      http: http({ failCik: '1919011' }).http,
      cfg,
      store,
      now: () => NOW,
      tickers: ['NVDA', 'RKLB'],
    });
    expect(run.status).toBe('error');
    expect(run.error).toContain('RKLB: SEC EDGAR is having problems (server-error)');
    expect(log.filings).toEqual([{ cik: '0001045810', n: 1 }]);
  });

  it('records an error when the ticker file is unavailable', async () => {
    const { store } = fakeStore();
    const run = await runSecJob({
      http: http({ tickerStatus: 503 }).http,
      cfg,
      store,
      now: () => NOW,
      tickers: ['NVDA'],
    });
    expect(run.error).toBe(
      'SEC ticker file unavailable: SEC EDGAR is having problems (server-error)',
    );
  });

  it('refuses to run with an undeclared User-Agent', async () => {
    const { store } = fakeStore();
    const run = await runSecJob({
      http: http().http,
      cfg: { ...cfg, userAgent: 'Marsad' },
      store,
      now: () => NOW,
      tickers: ['NVDA'],
    });
    expect(run.status).toBe('error');
    expect(run.error).toContain('SEC_USER_AGENT must be a name followed by a contact email');
  });
});
