import { describe, expect, it } from 'vitest';
import factsFixture from '../../../../fixtures/sec/companyfacts-NVDA-trimmed.json';
import form4Fixture from '../../../../fixtures/sec/form4-0001696841-26-000016.json';
import submissions from '../../../../fixtures/sec/submissions-NVDA-trimmed.json';
import { HttpClient, TokenBucket, type Clock, type FetchLike } from '../http.js';
import { fetchCompanyFacts, fetchForm4, form4Url } from './sec-facts.js';

const NOW = new Date('2026-11-24T18:00:00Z');
const cfg = { userAgent: 'Marsad research contact@example.com', now: () => NOW };

function setup(status: number, body: string) {
  const calls: { url: string; headers?: Record<string, string> }[] = [];
  const clock: Clock = { now: () => NOW.getTime(), sleep: () => Promise.resolve() };
  const fetch: FetchLike = (url, init) => {
    calls.push({ url, ...(init?.headers ? { headers: init.headers } : {}) });
    return Promise.resolve({
      status,
      headers: { get: () => null },
      text: () => Promise.resolve(body),
    });
  };
  return {
    http: new HttpClient({ fetch, clock, bucket: new TokenBucket(100, 100, clock), maxRetries: 0 }),
    calls,
  };
}

describe('company facts', () => {
  it('requests the padded CIK with a declared User-Agent and keeps provenance at the newest filing', async () => {
    const { http, calls } = setup(200, JSON.stringify(factsFixture.body));
    const r = await fetchCompanyFacts(http, cfg, 1045810);
    expect(calls[0]?.url).toBe('https://data.sec.gov/api/xbrl/companyfacts/CIK0001045810.json');
    expect(calls[0]?.headers?.['User-Agent']).toBe(cfg.userAgent);
    if (!r.ok) throw new Error(r.display);
    expect(r.data.value?.entityName).toBe('NVIDIA CORP');
    expect(r.data.provenance).toMatchObject({
      source: 'sec_edgar',
      asOf: '2026-08-26T00:00:00.000Z',
    });
  });
  it('reports a page that is not company facts as invalid data', async () => {
    const r = await fetchCompanyFacts(setup(200, '{"oops":1}').http, cfg, 1045810);
    expect(r).toMatchObject({ ok: false, kind: 'invalid-response' });
    expect(
      await fetchCompanyFacts(
        setup(200, '<html>Request rate threshold exceeded</html>').http,
        cfg,
        1,
      ),
    ).toMatchObject({ ok: false, kind: 'invalid-response' });
  });
  it('refuses to run without a declared contact', async () => {
    await expect(
      fetchCompanyFacts(setup(200, '{}').http, { ...cfg, userAgent: 'x' }, 1),
    ).rejects.toThrow(RangeError);
  });
});

describe('Form 4 documents', () => {
  it('builds the XML address from the filing index entry by dropping the rendered xsl folder', () => {
    const r = submissions.body.filings.recent;
    const i = r.form.indexOf('4');
    expect(r.primaryDocument[i]).toBe('xslF345X06/wk-form4_1795470863.xml');
    expect(form4Url(1045810, r.accessionNumber[i] as string, r.primaryDocument[i] as string)).toBe(
      '/Archives/edgar/data/1045810/000169684126000016/wk-form4_1795470863.xml',
    );
    expect(form4Url('0001045810', '0001197647-26-000013', 'wk-form4_1793999520.xml')).toBe(
      '/Archives/edgar/data/1045810/000119764726000013/wk-form4_1793999520.xml',
    );
  });
  it('refuses a document that is not ownership XML (an 8-K page, for example)', () => {
    expect(() => form4Url(1, '0001-26-000001', 'nvda-20261122.htm')).toThrow(RangeError);
  });
  it('fetches and parses a real filing', async () => {
    const { http, calls } = setup(200, form4Fixture.body);
    const r = await fetchForm4(
      http,
      cfg,
      1045810,
      '0001696841-26-000016',
      'xslF345X06/wk-form4_1795470863.xml',
    );
    expect(calls[0]?.url).toBe(
      'https://www.sec.gov/Archives/edgar/data/1045810/000169684126000016/wk-form4_1795470863.xml',
    );
    if (!r.ok) throw new Error(r.display);
    expect(r.data.value?.transactions).toHaveLength(12);
    expect(r.data.provenance.asOf).toBe('2026-11-19T00:00:00.000Z');
  });
  it('turns an error page served with HTTP 200 into an error, never into "no transactions"', async () => {
    const r = await fetchForm4(
      setup(200, '<html><body>Rate limit exceeded</body></html>').http,
      cfg,
      1045810,
      '0001-26-000001',
      'a.xml',
    );
    expect(r).toMatchObject({ ok: false, kind: 'invalid-response' });
  });
});
