import { describe, expect, it } from 'vitest';
import notEntitled from '../../../../fixtures/massive/not-entitled-403.json';
import sections from '../../../../fixtures/massive/sections-NVDA-risk_factors.json';
import { HttpClient, TokenBucket, type Clock, type FetchLike } from '../http.js';
import { fetchAnnualSections } from './massive-sections.js';
import type { MassiveConfig } from './massive.js';

const NOW = new Date('2026-11-24T20:00:00Z');
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

// Expected values were read from the recorded response with a separate script, not from the adapter.
describe('10-K sections (real NVIDIA response, recorded 2026-11-24 with the project key)', () => {
  it('reads both annual reports with their fiscal year ends, filing dates and sec.gov links', async () => {
    const { http, urls } = setup(200, sections.body);
    const r = await fetchAnnualSections(http, cfg, 'NVDA', 'risk_factors', 2);
    expect(urls[0]).toContain(
      '/stocks/filings/10-K/vX/sections?ticker=NVDA&section=risk_factors&limit=2&sort=period_end.desc',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [a, b] = r.data.value ?? [];
    expect(a).toMatchObject({
      cik: '0001045810',
      ticker: 'NVDA',
      section: 'risk_factors',
      filingDate: '2026-02-25',
      periodEnd: '2026-01-25',
      filingUrl: 'https://www.sec.gov/Archives/edgar/data/1045810/0001045810-26-000021.txt',
    });
    expect(a?.text.length).toBe(114916);
    expect(b).toMatchObject({ filingDate: '2025-02-26', periodEnd: '2025-01-26' });
    expect(b?.text.length).toBe(110844);
    expect(r.data.provenance).toMatchObject({
      source: 'massive',
      endpoint: '/stocks/filings/10-K/vX/sections',
      asOf: '2026-02-25T00:00:00.000Z',
    });
  });

  it('rejects a response whose section is not the one asked for, instead of mislabelling it', async () => {
    const { http } = setup(200, sections.body);
    const r = await fetchAnnualSections(http, cfg, 'NVDA', 'business', 2);
    expect(r).toMatchObject({ ok: false, kind: 'invalid-response' });
  });

  it('rejects a row with no text', async () => {
    const bad = { results: [{ ...sections.body.results[0], text: '' }] };
    const { http } = setup(200, bad);
    expect(await fetchAnnualSections(http, cfg, 'NVDA', 'risk_factors')).toMatchObject({
      ok: false,
      kind: 'invalid-response',
    });
  });

  it('reports a plan problem as such (the recorded not-entitled body)', async () => {
    const { http } = setup(403, notEntitled.body);
    expect(await fetchAnnualSections(http, cfg, 'NVDA', 'risk_factors')).toMatchObject({
      ok: false,
      kind: 'not-entitled',
    });
  });

  it('refuses a ticker or limit that could change the request', () => {
    const { http } = setup(200, sections.body);
    expect(() => fetchAnnualSections(http, cfg, 'NVDA&limit=999', 'risk_factors')).toThrow(
      RangeError,
    );
    expect(() => fetchAnnualSections(http, cfg, 'NVDA', 'risk_factors', 0)).toThrow(RangeError);
    expect(() => fetchAnnualSections(http, cfg, 'NVDA', 'risk_factors', 11)).toThrow(RangeError);
  });
});
