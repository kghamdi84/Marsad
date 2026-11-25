import { describe, expect, it } from 'vitest';
import grouped from '../../../../fixtures/massive/grouped-2026-11-24-trimmed.json';
import splits from '../../../../fixtures/massive/splits-2026-10-01-to-11-24.json';
import cs from '../../../../fixtures/massive/tickers-CS-2025-06-02-page1-trimmed.json';
import { HttpClient, TokenBucket, type Clock, type FetchLike } from '../http.js';
import {
  fetchGroupedDaily,
  fetchSplitsSince,
  fetchTickersOfType,
  nextPagePath,
} from './massive-breadth.js';
import type { MassiveConfig } from './massive.js';

const NOW = new Date('2026-11-25T09:00:00Z');
const cfg: MassiveConfig = { apiKey: 'k', planTier: 'end-of-day', now: () => NOW };

function setup(reply: (url: string) => { status: number; body: unknown }) {
  const urls: string[] = [];
  const clock: Clock = { now: () => NOW.getTime(), sleep: () => Promise.resolve() };
  const fetch: FetchLike = (url) => {
    urls.push(url);
    const r = reply(url);
    return Promise.resolve({
      status: r.status,
      headers: { get: () => null },
      text: () => Promise.resolve(JSON.stringify(r.body)),
    });
  };
  return {
    http: new HttpClient({ fetch, clock, bucket: new TokenBucket(100, 100, clock), maxRetries: 0 }),
    urls,
  };
}

// Expected values were read from the recorded files with a separate script, not from the adapters.
describe('grouped daily (real response for 2026-11-24, unadjusted, trimmed to 12 of 12,650 tickers)', () => {
  it('asks for unadjusted prices and reads each ticker close and volume', async () => {
    const { http, urls } = setup(() => ({ status: 200, body: grouped.body }));
    const r = await fetchGroupedDaily(http, cfg, '2026-11-24');
    expect(urls[0]).toContain('/v2/aggs/grouped/locale/us/market/stocks/2026-11-24?adjusted=false');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rows = r.data.value ?? [];
    expect(rows).toHaveLength(12);
    expect(rows.find((x) => x.ticker === 'TQQQ')).toEqual({
      ticker: 'TQQQ',
      close: 46.19,
      volume: 132725191.85275,
    });
    expect(rows.find((x) => x.ticker === 'QQQ')?.close).toBe(638.1);
  });
  it('a closed market is an empty list, not an error', async () => {
    const { http } = setup(() => ({
      status: 200,
      body: { status: 'OK', resultsCount: 0, results: [] },
    }));
    const r = await fetchGroupedDaily(http, cfg, '2026-11-26');
    expect(r.ok && r.data.value).toEqual([]);
  });
  it('a holiday reply without a results field is a closed market (the 2024-11-28 failure)', async () => {
    // The first live backfill stopped on Thanksgiving: zero records and no `results` field.
    const { http } = setup(() => ({
      status: 200,
      body: { adjusted: false, queryCount: 0, resultsCount: 0, status: 'OK', request_id: 'r' },
    }));
    const r = await fetchGroupedDaily(http, cfg, '2024-11-28');
    expect(r.ok && r.data.value).toEqual([]);
  });

  it('a missing results field is still an error unless the count is exactly zero', async () => {
    for (const body of [
      { status: 'OK' },
      { status: 'OK', resultsCount: 12 },
      { status: 'ERROR', resultsCount: 0 },
      { status: 'OK', resultsCount: '0' },
    ]) {
      const { http } = setup(() => ({ status: 200, body }));
      const r = await fetchGroupedDaily(http, cfg, '2024-11-28');
      expect(r, JSON.stringify(body)).toMatchObject({ ok: false, kind: 'invalid-response' });
      // The error names the fields that were there, never their values.
      expect(r.ok ? '' : r.message).toContain('fields: ');
    }
  });

  it('rejects a row without a close instead of storing a gap as zero', async () => {
    const { http } = setup(() => ({ status: 200, body: { results: [{ T: 'X', v: 1 }] } }));
    expect(await fetchGroupedDaily(http, cfg, '2026-11-24')).toMatchObject({
      ok: false,
      kind: 'invalid-response',
    });
  });
});

describe('all-market splits (real response, 2026-10-01 to 2026-11-24, trimmed to 40 of 261)', () => {
  it('reads every split, reverse splits included, oldest first', async () => {
    const { http, urls } = setup(() => ({ status: 200, body: splits.body }));
    const r = await fetchSplitsSince(http, cfg, '2026-10-01');
    expect(urls[0]).toContain(
      '/stocks/v1/splits?execution_date.gte=2026-10-01&limit=5000&sort=execution_date.asc',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.value).toHaveLength(40);
    expect(r.data.value?.[0]).toEqual({
      ticker: 'ZVLO',
      executionDate: '2026-10-01',
      splitFrom: 2000,
      splitTo: 1,
      vendorId: 'E4c3455c03188ad3bbb9e35bcf1f7ca66b09568fd34de4189b9d1a5323f053d9b',
      adjustmentType: 'reverse_split',
    });
  });
});

describe('common stocks and ETFs as of a date (real first page, trimmed to 15 of 1,000)', () => {
  it('follows next_url to the end, fetching each page once, and never sends a key in the path', async () => {
    const page2 = { status: 'OK', results: [{ ticker: 'ZZZZ', type: 'CS' }] };
    const { http, urls } = setup((url) =>
      url.includes('cursor=') ? { status: 200, body: page2 } : { status: 200, body: cs.body },
    );
    const r = await fetchTickersOfType(http, cfg, 'CS', '2025-06-02');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.value).toHaveLength(16);
    expect(r.data.value?.[0]).toBe('A');
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain(
      '/v3/reference/tickers?market=stocks&type=CS&date=2025-06-02&active=true&limit=1000',
    );
    expect(urls[1]).toContain('/v3/reference/tickers?cursor=');
    expect(urls[1]).not.toMatch(/apiKey/i);
  });
  it('rejects a page with a ticker of another type', async () => {
    const { http } = setup(() => ({
      status: 200,
      body: { results: [{ ticker: 'WRT', type: 'WARRANT' }] },
    }));
    expect(await fetchTickersOfType(http, cfg, 'CS', '2025-06-02')).toMatchObject({
      ok: false,
      kind: 'invalid-response',
    });
  });
  it('stops a runaway list after 30 pages instead of looping forever', async () => {
    const endless = {
      results: [{ ticker: 'A', type: 'ETF' }],
      next_url: 'https://api.massive.com/v3/reference/tickers?cursor=x',
    };
    const { http, urls } = setup(() => ({ status: 200, body: endless }));
    const r = await fetchTickersOfType(http, cfg, 'ETF', '2025-06-02');
    expect(r).toMatchObject({ ok: false, kind: 'invalid-response' });
    expect(urls).toHaveLength(30);
  });
});

describe('next_url to a path', () => {
  it('keeps the path and cursor, drops any key, and returns null at the end', () => {
    expect(
      nextPagePath('https://api.massive.com/v3/reference/tickers?cursor=abc&apiKey=secret'),
    ).toBe('/v3/reference/tickers?cursor=abc');
    expect(nextPagePath('https://api.massive.com/stocks/v1/splits?apikey=s')).toBe(
      '/stocks/v1/splits',
    );
    expect(nextPagePath(undefined)).toBeNull();
    expect(nextPagePath('')).toBeNull();
    expect(nextPagePath('http://evil.example/x')).toBeNull(); // not https: refused
  });
});
