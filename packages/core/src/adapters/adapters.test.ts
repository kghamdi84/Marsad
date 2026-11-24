import { describe, expect, it } from 'vitest';
import aggs from '../../../../fixtures/massive/aggs-SPY-1d-2026-10.json';
import dailyWeek from '../../../../fixtures/massive/aggs-SPY-1d-2026-11-16-to-20.json';
import minuteDay from '../../../../fixtures/massive/aggs-SPY-1m-2026-11-18.json';
import notEntitled from '../../../../fixtures/massive/not-entitled-403.json';
import fredReal from '../../../../fixtures/fred/observations-DGS10-2026-11.json';
import secSubmissions from '../../../../fixtures/sec/submissions-NVDA-trimmed.json';
import secTickers from '../../../../fixtures/sec/company-tickers-trimmed.json';
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
import {
  fetchDailyBars,
  fetchMarketHolidays,
  fetchMinuteBars,
  fetchSplits,
  type MassiveConfig,
} from './massive.js';
import { fetchFredSeries, redactKey } from './fred.js';
import { assertDeclaredUserAgent, fetchRecentFilings, parseCompanyTickers } from './sec.js';
import { volumeWeightedPrice } from '../indicators.js';

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
    // Synthetic body for this unit; the real recorded 403 body is tested in 'real recorded responses' below.
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

describe('FRED adapter (synthetic bodies for edge cases; real recording tested below)', () => {
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

describe('SEC adapter (synthetic bodies for edge cases; real recording tested below)', () => {
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

describe('Massive minute bars (synthetic body for edge cases; real recording tested below)', () => {
  const body = JSON.stringify({
    ticker: 'SPY',
    results: [
      { v: 100, vw: 50.1, o: 50, c: 50.2, h: 50.3, l: 49.9, t: 1795165200000, n: 10 },
      { v: 300, vw: 50.4, o: 50.2, c: 50.5, h: 50.6, l: 50.1, t: 1795165260000, n: 30 },
    ],
  });

  it('asks for one day of 1-minute bars with the 50,000 limit and keeps the vendor VWAP', async () => {
    const { http, calls } = setup(200, body);
    const r = await fetchMinuteBars(http, massive, 'SPY', '2026-11-20');
    expect(calls[0]?.url).toContain(
      '/v2/aggs/ticker/SPY/range/1/minute/2026-11-20/2026-11-20?adjusted=true&sort=asc&limit=50000',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.value?.map((b) => b.vw)).toEqual([50.1, 50.4]);
    expect(r.data.provenance.asOf).toBe(new Date(1795165260000).toISOString());
  });

  it('rejects a bad ticker or date before any request', () => {
    const { http, calls } = setup(200, body);
    expect(() => fetchMinuteBars(http, massive, 'spy', '2026-11-20')).toThrow(RangeError);
    expect(() => fetchMinuteBars(http, massive, 'SPY', '11/20/2026')).toThrow(RangeError);
    expect(calls).toHaveLength(0);
  });

  it('reports an impossible bar as invalid data, not as a price', async () => {
    const bad = JSON.stringify({
      results: [{ v: 1, vw: 5, o: 5, c: 9, h: 6, l: 4, t: 1795165200000 }], // close above high
    });
    const { http } = setup(200, bad);
    const r = await fetchMinuteBars(http, massive, 'SPY', '2026-11-20');
    expect(r.ok).toBe(false);
  });
});

// Bodies below were recorded from the live services on 2026-11-24 by the manual record-fixtures workflow
// (see fixtures/README.md). Expected values were computed independently in Python from the same files.
describe('real recorded responses (2026-11-24)', () => {
  it('FRED: parses the real DGS10 body, with "." on Veterans Day as null', async () => {
    const { http } = setup(200, JSON.stringify(fredReal.body));
    const r = await fetchFredSeries(http, { apiKey: 'k', now: () => NOW }, 'DGS10', '2026-11-05');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const obs = r.data.value ?? [];
    expect(obs).toHaveLength(12);
    expect(obs.find((o) => o.date === '2026-11-11')?.value).toBeNull();
    expect(obs.at(-1)).toEqual({ date: '2026-11-20', value: 4.92 });
    expect(r.data.provenance.asOf).toBe('2026-11-20T00:00:00.000Z');
  });

  it('SEC: parses the real NVIDIA submissions body, including 8-K items and Form 4s', async () => {
    const { http } = setup(200, JSON.stringify(secSubmissions.body));
    const r = await fetchRecentFilings(
      http,
      { userAgent: 'Marsad research contact@example.com', now: () => NOW },
      1045810,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const filings = r.data.value ?? [];
    expect(filings).toHaveLength(8);
    expect(filings[0]).toMatchObject({ accession: '0001696841-26-000016', form: '4', items: [] });
    expect(filings[1]).toMatchObject({
      accession: '0001045810-26-000090',
      form: '8-K',
      filingDate: '2026-11-23',
      acceptedAt: '2026-11-23T13:57:54.000Z',
      items: ['5.02', '9.01'],
      primaryDocument: 'nvda-20261122.htm',
    });
  });

  it('SEC: maps tickers to zero-padded CIKs from the real company file', () => {
    const map = parseCompanyTickers(secTickers.body);
    expect(map.get('NVDA')).toMatchObject({ cik: '0001045810', ticker: 'NVDA' });
    expect(map.get('AAPL')?.cik).toBe('0000320193');
  });

  it('Massive: the real not-entitled body (HTTP 403, NOT_AUTHORIZED) says a higher plan is needed', async () => {
    expect(notEntitled.status).toBe(403);
    const { http } = setup(403, JSON.stringify(notEntitled.body));
    const r = await fetchMinuteBars(http, massive, 'SPY', '2026-11-18');
    expect(r).toMatchObject({ ok: false, kind: 'not-entitled' });
    if (!r.ok) expect(r.display).toBe('Requires a higher Massive plan');
  });

  it('Massive: the real 1-minute day rebuilds the vendor daily VWAP within 0.1% (observed +0.008%)', async () => {
    const minute = setup(200, JSON.stringify(minuteDay.body));
    const m = await fetchMinuteBars(minute.http, massive, 'SPY', '2026-11-18');
    const day = setup(200, JSON.stringify(dailyWeek.body));
    const d = await fetchDailyBars(day.http, massive, 'SPY', '2026-11-16', '2026-11-20');
    expect(m.ok && d.ok).toBe(true);
    if (!m.ok || !d.ok) return;
    const bars = m.data.value ?? [];
    expect(bars).toHaveLength(931);
    expect(bars.every((b) => typeof b.vw === 'number')).toBe(true);
    const computed = volumeWeightedPrice(
      bars.map((b) => b.vw ?? Number.NaN),
      bars.map((b) => b.v),
    );
    expect(computed).toBeCloseTo(731.0142679493207, 9); // independent Python computation
    const vendor = (d.data.value ?? []).find((b) => b.t === 1794978000000)?.vw;
    expect(vendor).toBe(730.9578);
    expect(Math.abs((computed ?? 0) / (vendor ?? 1) - 1)).toBeLessThan(0.001);
    // Minute bars carry about 93% of the day's volume, so they are not a full tape.
    const share =
      bars.reduce((a, b) => a + b.v, 0) /
      (d.data.value ?? []).find((b) => b.t === 1794978000000)!.v;
    expect(share).toBeGreaterThan(0.92);
    expect(share).toBeLessThan(0.94);
  });
});
