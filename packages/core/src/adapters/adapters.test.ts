import { describe, expect, it } from 'vitest';
import aggs from '../../../../fixtures/massive/aggs-SPY-1d-2026-10.json';
import holidays from '../../../../fixtures/massive/market-status-upcoming.json';
import splitsFixture from '../../../../fixtures/massive/splits-NVDA.json';
import {
  HttpClient,
  TokenBucket,
  TtlCache,
  type Clock,
  type FetchLike,
  type FetchResponse,
} from '../http.js';
import { fetchDailyBars, fetchMarketHolidays, fetchSplits, type MassiveConfig } from './massive.js';
import { fetchFredSeries, redactKey } from './fred.js';
import { assertDeclaredUserAgent, fetchRecentFilings } from './sec.js';

const NOW = new Date('2026-11-23T19:40:00Z');

function setup(status: number, body: string, headers: Record<string, string> = {}) {
  const calls: { url: string; headers: Record<string, string> | undefined }[] = [];
  const clock: Clock = { now: () => NOW.getTime(), sleep: () => Promise.resolve() };
  const response: FetchResponse = {
    status,
    headers: { get: (n) => headers[n.toLowerCase()] ?? null },
    text: () => Promise.resolve(body),
  };
  const fetch: FetchLike = (url, init) => {
    calls.push({ url, headers: init?.headers });
    return Promise.resolve(response);
  };
  const http = new HttpClient({
    fetch,
    clock,
    bucket: new TokenBucket(100, 100, clock),
    cache: new TtlCache<string>(),
    maxRetries: 0,
  });
  return { http, calls };
}

const massive: MassiveConfig = {
  apiKey: 'test-key-not-real',
  planTier: 'end-of-day',
  now: () => NOW,
};

describe('Massive adapter on recorded fixtures', () => {
  it('parses holidays and early closes with provenance', async () => {
    const { http, calls } = setup(200, JSON.stringify(holidays.data));
    const r = await fetchMarketHolidays(http, massive);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.value).toHaveLength(24);
    expect(
      r.data.value?.find((x) => x.date === '2026-11-27' && x.exchange === 'NYSE'),
    ).toMatchObject({
      status: 'early-close',
      close: '2026-11-27T18:00:00.000Z',
    });
    expect(r.data.provenance).toMatchObject({
      source: 'massive',
      endpoint: '/v1/marketstatus/upcoming',
      planTier: 'end-of-day',
    });
    expect(calls[0]?.url).toBe('https://api.massive.com/v1/marketstatus/upcoming');
  });

  it('sends the key in the Authorization header, never in the URL', async () => {
    const { http, calls } = setup(200, JSON.stringify(holidays.data));
    await fetchMarketHolidays(http, massive);
    expect(calls[0]?.headers?.['Authorization']).toBe('Bearer test-key-not-real');
    expect(calls[0]?.url).not.toContain('test-key-not-real');
  });

  it('parses daily bars, with asOf at the last bar', async () => {
    const { http, calls } = setup(200, JSON.stringify({ status: 'OK', results: aggs.results }));
    const r = await fetchDailyBars(http, massive, 'SPY', '2026-10-01', '2026-10-30');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.value).toHaveLength(22);
    expect(r.data.value?.at(-1)).toMatchObject({ c: 755.72, v: 77696475.732216 });
    expect(r.data.provenance.asOf).toBe('2026-10-30T04:00:00.000Z');
    expect(calls[0]?.url).toContain(
      '/v2/aggs/ticker/SPY/range/1/day/2026-10-01/2026-10-30?adjusted=true&sort=asc',
    );
  });

  it('rejects an impossible bar as invalid rather than passing it on', async () => {
    const bad = [{ t: 1790827200000, o: 10, h: 9, l: 11, c: 10, v: 100 }]; // high below low
    const { http } = setup(200, JSON.stringify({ results: bad }));
    const r = await fetchDailyBars(http, massive, 'SPY', '2026-10-01', '2026-10-30');
    expect(r).toMatchObject({ ok: false, kind: 'invalid-response' });
  });

  it('parses splits from the recorded NVDA rows', async () => {
    const { http } = setup(200, JSON.stringify({ results: splitsFixture.data }));
    const r = await fetchSplits(http, massive, 'NVDA');
    expect(r.ok && r.data.value?.map((s) => s.executionDate)).toEqual([
      '2024-06-10',
      '2021-07-20',
      '2007-09-11',
    ]);
  });

  it('turns an entitlement error into "requires plan", not an outage', async () => {
    // Synthetic body in the documented Polygon-lineage shape (not a recorded Massive response).
    const body = JSON.stringify({
      status: 'NOT_AUTHORIZED',
      message: 'You are not entitled to this data.',
    });
    const { http } = setup(403, body);
    const r = await fetchDailyBars(http, massive, 'SPY', '2026-10-01', '2026-10-30');
    expect(r).toMatchObject({
      ok: false,
      kind: 'not-entitled',
      planTier: 'unavailable',
      display: 'Requires a higher Massive plan',
    });
  });

  it('reports a server error as an outage with its own text', async () => {
    const { http } = setup(503, 'down');
    const r = await fetchMarketHolidays(http, massive);
    expect(r).toMatchObject({
      ok: false,
      kind: 'server-error',
      display: 'Massive is having problems',
    });
  });

  it('rejects malformed tickers before any request', () => {
    const { http, calls } = setup(200, '{}');
    expect(() => fetchDailyBars(http, massive, 'spy; drop', '2026-10-01', '2026-10-30')).toThrow(
      RangeError,
    );
    expect(calls).toHaveLength(0);
  });
});

describe('FRED adapter (SYNTHETIC body in the documented shape)', () => {
  const cfg = { apiKey: 'fred-secret-key', now: () => NOW };
  const body = JSON.stringify({
    observations: [
      {
        realtime_start: '2026-11-23',
        realtime_end: '2026-11-23',
        date: '2026-11-19',
        value: '4.05',
      },
      { realtime_start: '2026-11-23', realtime_end: '2026-11-23', date: '2026-11-20', value: '.' },
      {
        realtime_start: '2026-11-23',
        realtime_end: '2026-11-23',
        date: '2026-11-21',
        value: '4.11',
      },
    ],
  });
  it('turns "." into null and dates provenance at the last real value', async () => {
    const { http, calls } = setup(200, body);
    const r = await fetchFredSeries(http, cfg, 'DGS10', '2026-11-01');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.value?.map((o) => o.value)).toEqual([4.05, null, 4.11]);
    expect(r.data.provenance.asOf).toBe('2026-11-21T00:00:00.000Z');
    expect(r.data.provenance.planTier).toBe('end-of-day');
    expect(calls[0]?.url).toContain('series_id=DGS10');
  });
  it('never stores the API key in provenance', async () => {
    const { http } = setup(200, body);
    const r = await fetchFredSeries(http, cfg, 'DGS10', '2026-11-01');
    expect(JSON.stringify(r)).not.toContain('fred-secret-key');
  });
  it('redacts keys from any URL string', () => {
    expect(redactKey('https://x/y?a=1&api_key=abc123&b=2')).toBe(
      'https://x/y?a=1&api_key=REDACTED&b=2',
    );
  });
  it('rejects non-numeric values and unknown series', async () => {
    const bad = JSON.stringify({ observations: [{ date: '2026-11-19', value: 'abc' }] });
    expect(await fetchFredSeries(setup(200, bad).http, cfg, 'DGS10', '2026-11-01')).toMatchObject({
      ok: false,
      kind: 'invalid-response',
    });
    await expect(
      fetchFredSeries(setup(200, body).http, cfg, 'NOPE' as 'DGS10', '2026-11-01'),
    ).rejects.toThrow(RangeError);
  });
});

describe('SEC adapter (SYNTHETIC body in the documented shape)', () => {
  const cfg = { userAgent: 'Marsad research contact@example.com', now: () => NOW };
  const body = JSON.stringify({
    cik: '1045810',
    filings: {
      recent: {
        accessionNumber: ['0001045810-26-000100', '0001045810-26-000099'],
        form: ['8-K', '4'],
        filingDate: ['2026-11-20', '2026-11-19'],
        acceptanceDateTime: ['2026-11-20T21:05:11.000Z', '2026-11-19T22:30:00.000Z'],
        primaryDocument: ['nvda-8k.htm', 'form4.xml'],
        items: ['2.02,9.01', ''],
      },
    },
  });
  it('sends a declared User-Agent, pads the CIK and parses 8-K items', async () => {
    const { http, calls } = setup(200, body);
    const r = await fetchRecentFilings(http, cfg, 1045810);
    expect(calls[0]?.url).toBe('https://data.sec.gov/submissions/CIK0001045810.json');
    expect(calls[0]?.headers?.['User-Agent']).toBe('Marsad research contact@example.com');
    expect(r.ok && r.data.value?.[0]).toMatchObject({
      form: '8-K',
      items: ['2.02', '9.01'],
      acceptedAt: '2026-11-20T21:05:11.000Z',
    });
    expect(r.ok && r.data.provenance).toMatchObject({
      source: 'sec_edgar',
      asOf: '2026-11-20T21:05:11.000Z',
    });
  });
  it('refuses to run without a declared contact', async () => {
    expect(() => assertDeclaredUserAgent('Marsad')).toThrow(RangeError);
    expect(() => assertDeclaredUserAgent('node')).toThrow(RangeError);
    // A web address alone is not what the SEC asks for, and neither is an email with no name.
    expect(() => assertDeclaredUserAgent('Marsad research https://example.com')).toThrow(
      RangeError,
    );
    expect(() => assertDeclaredUserAgent('contact@example.com')).toThrow(RangeError);
    expect(() => assertDeclaredUserAgent('Marsad research contact@example.com')).not.toThrow();
    await expect(
      fetchRecentFilings(setup(200, body).http, { ...cfg, userAgent: 'x' }, 1),
    ).rejects.toThrow(RangeError);
  });
  it('rejects unequal columns instead of misaligning filings', async () => {
    const bad = JSON.stringify({
      filings: {
        recent: { accessionNumber: ['a'], form: ['8-K', '4'], filingDate: ['2026-11-20'] },
      },
    });
    expect(await fetchRecentFilings(setup(200, bad).http, cfg, 1)).toMatchObject({
      ok: false,
      kind: 'invalid-response',
    });
  });
});
