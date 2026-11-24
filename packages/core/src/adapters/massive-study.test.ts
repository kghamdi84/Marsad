import { describe, expect, it } from 'vitest';
import dividends from '../../../../fixtures/massive/dividends-NVDA.json';
import news from '../../../../fixtures/massive/news-NVDA.json';
import notEntitled from '../../../../fixtures/massive/not-entitled-403.json';
import shortInterest from '../../../../fixtures/massive/short-interest-NVDA.json';
import shortVolume from '../../../../fixtures/massive/short-volume-NVDA.json';
import { HttpClient, TokenBucket, type Clock, type FetchLike } from '../http.js';
import { classifyPublisher, clusterNews } from '../news.js';
import {
  fetchDividends,
  fetchNews,
  fetchShortInterest,
  fetchShortVolume,
} from './massive-study.js';
import type { MassiveConfig } from './massive.js';

const NOW = new Date('2026-11-24T18:00:00Z');
const cfg: MassiveConfig = { apiKey: 'k', planTier: 'end-of-day', now: () => NOW };

function setup(status: number, body: unknown) {
  const urls: string[] = [];
  const clock: Clock = { now: () => NOW.getTime(), sleep: () => Promise.resolve() };
  const fetch: FetchLike = (url) => {
    urls.push(url);
    return Promise.resolve({
      status,
      headers: { get: () => null },
      text: () => Promise.resolve(JSON.stringify(body)),
    });
  };
  return {
    http: new HttpClient({ fetch, clock, bucket: new TokenBucket(100, 100, clock), maxRetries: 0 }),
    urls,
  };
}

// Expected values below were read from the recorded files with a separate script, not from the adapters.
describe('news (30 real NVDA articles, recorded 2026-11-24)', () => {
  it('reads every article with its publisher name, UTC time and the vendor sentiment', async () => {
    const { http, urls } = setup(200, news.body);
    const r = await fetchNews(http, cfg, 'NVDA');
    expect(urls[0]).toContain(
      '/v2/reference/news?ticker=NVDA&limit=30&order=desc&sort=published_utc',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const a = r.data.value ?? [];
    expect(a).toHaveLength(30);
    expect(a[0]).toMatchObject({
      publisher: 'The Motley Fool',
      title: 'Why Sandisk Stock Plunged Today',
      publishedAt: '2026-11-24T17:45:55.000Z',
      tickers: ['SNDK', 'NVDA'],
    });
    expect(a[0]?.sentiment[0]).toMatchObject({ ticker: 'SNDK', label: 'negative' });
    expect(r.data.provenance).toMatchObject({
      source: 'massive',
      endpoint: '/v2/reference/news',
      asOf: '2026-11-24T17:45:55.000Z',
    });
  });
  it('the free plan sends three publishers, so tiers are tier 3 analysis sites and a tier 2 wire', async () => {
    const { http } = setup(200, news.body);
    const r = await fetchNews(http, cfg, 'NVDA');
    const names = r.ok ? [...new Set((r.data.value ?? []).map((x) => x.publisher))].sort() : [];
    expect(names).toEqual(['GlobeNewswire Inc.', 'The Motley Fool', 'Zacks Investment Research']);
    expect(classifyPublisher('GlobeNewswire Inc.').tier).toBe(2);
    expect(classifyPublisher('The Motley Fool')).toMatchObject({ tier: 3, opinion: true });
  });
  it('clusters the 30 real headlines without merging unrelated stories', async () => {
    const { http } = setup(200, news.body);
    const r = await fetchNews(http, cfg, 'NVDA');
    if (!r.ok) throw new Error('fetch failed');
    const clusters = clusterNews(r.data.value ?? []);
    // No two of these 30 headlines are the same story. Before the ticker and same-outlet guards, two templated
    // Zacks headlines about different funds were merged into one cluster of 29.
    expect(clusters).toHaveLength(30);
  });
  it('rejects a body whose articles lack the fields it needs', async () => {
    const r = await fetchNews(
      setup(200, { results: [{ id: 'x', title: 'No publisher' }] }).http,
      cfg,
      'NVDA',
    );
    expect(r).toMatchObject({ ok: false, kind: 'invalid-response' });
  });
});

describe('short interest (real NVDA rows)', () => {
  it('reads the twice-monthly rows with settlement date, shares short and days to cover', async () => {
    const { http, urls } = setup(200, shortInterest.body);
    const r = await fetchShortInterest(http, cfg, 'NVDA', '2025-06-01');
    expect(urls[0]).toContain(
      '/stocks/v1/short-interest?ticker=NVDA&settlement_date.gte=2025-06-01',
    );
    if (!r.ok) throw new Error(r.display);
    const rows = r.data.value ?? [];
    expect(rows).toHaveLength(shortInterest.body.results.length);
    expect(rows.at(-1)).toEqual({
      ticker: 'NVDA',
      settlementDate: '2026-10-30',
      shortInterest: 279_579_505,
      avgDailyVolume: 99_940_095,
      daysToCover: 2.8,
    });
  });
});

describe('short volume (real NVDA rows)', () => {
  it('reads the daily rows and keeps the ratio the vendor computed', async () => {
    const { http } = setup(200, shortVolume.body);
    const r = await fetchShortVolume(http, cfg, 'NVDA', '2026-10-01');
    if (!r.ok) throw new Error(r.display);
    const rows = r.data.value ?? [];
    expect(rows).toHaveLength(shortVolume.body.results.length);
    expect(rows.at(-1)).toMatchObject({
      date: '2026-11-23',
      totalVolume: 310_699_598.518665,
      shortVolume: 90_419_413.168394,
      shortVolumeRatio: 29.1,
      exemptVolume: 3_878_108.82684,
    });
  });
});

describe('dividends (real NVDA rows, including one declared but not yet paid)', () => {
  it('reads every date and the cash amount', async () => {
    const { http } = setup(200, dividends.body);
    const r = await fetchDividends(http, cfg, 'NVDA', '2024-01-01');
    if (!r.ok) throw new Error(r.display);
    const rows = r.data.value ?? [];
    expect(rows).toHaveLength(dividends.body.results.length);
    expect(rows.at(-1)).toMatchObject({
      ticker: 'NVDA',
      declarationDate: '2026-11-17',
      exDividendDate: '2026-12-02',
      recordDate: '2026-12-02',
      payDate: '2026-12-23',
      cashAmount: 0.25,
      currency: 'USD',
      frequency: 4,
    });
  });
});

describe('plan problems and bad input', () => {
  it('reports the real not-entitled body as a plan problem for every endpoint', async () => {
    for (const call of [
      () => fetchNews(setup(403, notEntitled.body).http, cfg, 'NVDA'),
      () => fetchShortInterest(setup(403, notEntitled.body).http, cfg, 'NVDA', '2025-01-01'),
      () => fetchShortVolume(setup(403, notEntitled.body).http, cfg, 'NVDA', '2025-01-01'),
      () => fetchDividends(setup(403, notEntitled.body).http, cfg, 'NVDA', '2025-01-01'),
    ]) {
      const r = await call();
      expect(r).toMatchObject({ ok: false, kind: 'not-entitled' });
    }
  });
  it('rejects a bad ticker or date before any request', () => {
    const { http, urls } = setup(200, {});
    expect(() => fetchNews(http, cfg, 'nvda; drop')).toThrow(RangeError);
    expect(() => fetchShortInterest(http, cfg, 'NVDA', '06/2025')).toThrow(RangeError);
    expect(urls).toHaveLength(0);
  });
});
