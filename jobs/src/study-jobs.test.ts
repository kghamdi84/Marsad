import { describe, expect, it } from 'vitest';
import factsFixture from '../../fixtures/sec/companyfacts-NVDA-trimmed.json';
import form4Sales from '../../fixtures/sec/form4-0001696841-26-000016.json';
import form4Gift from '../../fixtures/sec/form4-0001197647-26-000013.json';
import form3Mixed from '../../fixtures/sec/form3-0002164059-26-000002.json';
import form3None from '../../fixtures/sec/form3-0001773751-26-000248.json';
import form3Joint from '../../fixtures/sec/form3A-0001209191-22-023889.json';
import form5Amended from '../../fixtures/sec/form5A-0001045810-25-000070.json';
import dividends from '../../fixtures/massive/dividends-NVDA.json';
import news from '../../fixtures/massive/news-NVDA.json';
import sections from '../../fixtures/massive/sections-NVDA-risk_factors.json';
import business from '../../fixtures/massive/sections-NVDA-business.json';
import notEntitled from '../../fixtures/massive/not-entitled-403.json';
import shortInterest from '../../fixtures/massive/short-interest-NVDA.json';
import shortVolume from '../../fixtures/massive/short-volume-NVDA.json';
import { STARTING_STOCKS, type MassiveConfig, type SecConfig } from '@marsad/core';
import { runFactsJob } from './facts-job.js';
import { fakeStore } from './fake-store.js';
import { runInsidersJob } from './insiders-job.js';
import { runNewsJob } from './news-job.js';
import { runSectionsJob } from './sections-job.js';
import { runStudyDataJob } from './study-data-job.js';
import { routedHttp } from './test-http.js';

const NOW = new Date('2026-11-24T23:15:00Z');
const sec: SecConfig = { userAgent: 'Marsad research contact@example.com', now: () => NOW };
const massive: MassiveConfig = { apiKey: 'k', planTier: 'end-of-day', now: () => NOW };
const NVDA = { cik: '0001045810', ticker: 'NVDA' };

describe('runFactsJob on the real NVIDIA company facts', () => {
  it('stores only the concepts the Study page reads, keeps filing dates, and marks the source live', async () => {
    const { store, log } = fakeStore({ instruments: [NVDA] });
    const { http } = routedHttp(NOW, [
      ['/companyfacts/CIK0001045810.json', { status: 200, body: factsFixture.body }],
    ]);
    const run = await runFactsJob({ http, cfg: sec, store, now: () => NOW });
    expect(run.status).toBe('ok');
    // 224 of the 240 recorded rows are for the 13 financial concepts and the share count (counted separately in
    // Python); the 16 capex rows are left out.
    expect(run.rows_written).toBe(224);
    expect(log.facts[0]?.facts).toHaveLength(224);
    expect(
      log.facts[0]?.facts.some((f) => f.concept === 'PaymentsToAcquirePropertyPlantAndEquipment'),
    ).toBe(false);
    expect(
      log.facts[0]?.facts.find(
        (f) => f.concept === 'Revenues' && f.end === '2026-07-26' && f.start === '2026-04-27',
      ),
    ).toMatchObject({ value: 96_221_000_000, filed: '2026-08-26' });
    expect(log.statuses[0]).toMatchObject({ source: 'sec_facts', state: 'live' });
  });
  it('names a company the SEC did not answer for and does not mark the source live', async () => {
    const { store, log } = fakeStore({ instruments: [NVDA] });
    const { http } = routedHttp(NOW, [['/companyfacts/', { status: 404, body: 'not found' }]]);
    const run = await runFactsJob({ http, cfg: sec, store, now: () => NOW });
    expect(run.status).toBe('error');
    expect(run.error).toContain('Financial facts failed: NVDA');
    expect(log.statuses).toEqual([]);
  });
  it('fails loudly when no instruments exist yet, and when a company reports none of the expected concepts', async () => {
    const none = await runFactsJob({
      http: routedHttp(NOW, []).http,
      cfg: sec,
      store: fakeStore().store,
      now: () => NOW,
    });
    expect(none.error).toContain('SEC filings job has to run first');
    const empty = {
      cik: 1,
      entityName: 'X',
      facts: {
        'us-gaap': {
          Other: {
            units: { USD: [{ end: '2026-01-01', val: 1, accn: 'a', filed: '2026-01-02' }] },
          },
        },
      },
    };
    const { http } = routedHttp(NOW, [['/companyfacts/', { status: 200, body: empty }]]);
    const run = await runFactsJob({
      http,
      cfg: sec,
      store: fakeStore({ instruments: [NVDA] }).store,
      now: () => NOW,
    });
    expect(run.error).toContain('NVDA: none of the expected concepts were reported');
  });
});

describe('runInsidersJob on real Form 4 documents', () => {
  const candidates = [
    {
      accession: '0001696841-26-000016',
      cik: '0001045810',
      primaryDocument: 'xslF345X06/wk-form4_1795470863.xml',
      acceptedAt: '2026-11-19T21:54:28.000Z',
    },
    {
      accession: '0001197647-26-000013',
      cik: '0001045810',
      primaryDocument: 'xslF345X06/wk-form4_1793999520.xml',
      acceptedAt: '2026-11-06T21:00:00.000Z',
    },
  ];
  const routes = [
    ['000169684126000016', { status: 200, body: form4Sales.body }],
    ['000119764726000013', { status: 200, body: form4Gift.body }],
  ] as const;

  it('reads each filing, stores the insider, the 10b5-1 flag and every transaction, and marks the source live', async () => {
    const { store, log } = fakeStore({ insiderCandidates: candidates });
    const { http, urls } = routedHttp(NOW, routes);
    const run = await runInsidersJob({ http, cfg: sec, store, now: () => NOW });
    // 12 sales plus 1 gift, and the holdings rows these two Form 4s carry (1 direct, then 1 direct and 1 indirect)
    expect(run).toMatchObject({ status: 'ok', rows_written: 16 });
    expect(urls[0]).toContain(
      '/Archives/edgar/data/1045810/000169684126000016/wk-form4_1795470863.xml',
    );
    expect(log.insiders.map((r) => [r.accession, r.status])).toEqual([
      ['0001696841-26-000016', 'ok'],
      ['0001197647-26-000013', 'ok'],
    ]);
    const first = log.insiders[0];
    if (first?.status !== 'ok') throw new Error('expected ok');
    expect(first.doc.plan10b5).toBe(true);
    expect(first.filedAt).toBe('2026-11-19T21:54:28.000Z');
    expect(log.statuses[0]).toMatchObject({ source: 'sec_insiders', state: 'live' });
  });
  it('reads Forms 3 and 5 and their amendments too: holdings, the no-securities statement, late trades', async () => {
    const mk = (accession: string, doc: string, at: string) => ({
      accession,
      cik: '0001849056',
      primaryDocument: `xslF345X05/${doc}`,
      acceptedAt: at,
    });
    const { store, log } = fakeStore({
      insiderCandidates: [
        mk('0002164059-26-000002', 'f3a.xml', '2026-11-12T21:00:00.000Z'),
        mk('0001773751-26-000248', 'f3b.xml', '2026-11-12T20:00:00.000Z'),
        mk('0001209191-22-023889', 'f3c.xml', '2022-04-08T20:00:00.000Z'),
        mk('0001045810-25-000070', 'f5.xml', '2025-03-21T20:00:00.000Z'),
      ],
    });
    const { http } = routedHttp(NOW, [
      ['000216405926000002', { status: 200, body: form3Mixed.body }],
      ['000177375126000248', { status: 200, body: form3None.body }],
      ['000120919122023889', { status: 200, body: form3Joint.body }],
      ['000104581025000070', { status: 200, body: form5Amended.body }],
    ]);
    const run = await runInsidersJob({ http, cfg: sec, store, now: () => NOW });
    // 6 holdings + 0 (owns nothing) + 1 holding + (2 sales + 1 holding)
    expect(run).toMatchObject({ status: 'ok', rows_written: 10 });
    const docs = log.insiders.map((r) => (r.status === 'ok' ? r.doc : null));
    expect(docs.map((d) => d?.documentType)).toEqual(['3', '3', '3/A', '5/A']);
    expect(docs[1]).toMatchObject({ noSecuritiesOwned: true, holdings: [] });
    expect(docs[2]?.owners).toHaveLength(4);
    expect(docs[3]).toMatchObject({ isAmendment: true, dateOfOriginalSubmission: '2025-03-12' });
    expect(log.statuses[0]).toMatchObject({ source: 'sec_insiders', state: 'live' });
  });
  it('stores an error page served with HTTP 200 as an unreadable filing and fails the run, never as "no transactions"', async () => {
    const { store, log } = fakeStore({ insiderCandidates: candidates.slice(0, 1) });
    const { http } = routedHttp(NOW, [
      ['/Archives/', { status: 200, body: '<html>Request rate threshold exceeded</html>' }],
    ]);
    const run = await runInsidersJob({ http, cfg: sec, store, now: () => NOW });
    expect(run.status).toBe('error');
    expect(run.error).toContain('1 unreadable');
    expect(log.insiders[0]).toMatchObject({ status: 'error', accession: '0001696841-26-000016' });
    expect(log.statuses).toEqual([]);
  });
  it('does not store a filing that failed to download, so the next run tries again', async () => {
    const { store, log } = fakeStore({ insiderCandidates: candidates.slice(0, 1) });
    const { http } = routedHttp(NOW, [['/Archives/', { status: 503, body: 'down' }]]);
    const run = await runInsidersJob({ http, cfg: sec, store, now: () => NOW });
    expect(run.status).toBe('error');
    expect(run.error).toContain('1 failed to fetch');
    expect(log.insiders).toEqual([]);
  });
  it('stores a filing whose index entry is not an XML document as an error', async () => {
    const { store, log } = fakeStore({
      insiderCandidates: [
        {
          accession: '0001-26-000001',
          cik: '0001045810',
          primaryDocument: 'filing.htm',
          acceptedAt: null,
        },
      ],
    });
    const run = await runInsidersJob({
      http: routedHttp(NOW, []).http,
      cfg: sec,
      store,
      now: () => NOW,
    });
    expect(run.status).toBe('error');
    expect(log.insiders[0]).toMatchObject({ status: 'error' });
  });
  it('is an ok run with nothing to do when every filing has been read', async () => {
    const run = await runInsidersJob({
      http: routedHttp(NOW, []).http,
      cfg: sec,
      store: fakeStore().store,
      now: () => NOW,
    });
    expect(run).toMatchObject({ status: 'ok', rows_written: 0 });
  });
});

describe('runNewsJob on the real NVDA news', () => {
  it('stores each article once even when two tickers return it, and marks the source live', async () => {
    const { store, log } = fakeStore();
    const { http, urls } = routedHttp(NOW, [
      ['/v2/reference/news', { status: 200, body: news.body }],
    ]);
    const run = await runNewsJob({
      http,
      cfg: massive,
      store,
      now: () => NOW,
      tickers: ['NVDA', 'AMD'],
    });
    expect(run).toMatchObject({ status: 'ok', rows_written: 30 });
    expect(urls).toHaveLength(2);
    expect(log.statuses[0]).toMatchObject({
      source: 'massive_news',
      note: '30 articles, newest 2026-11-24T17:45Z',
    });
  });
  it('names a ticker the plan does not cover', async () => {
    const { http } = routedHttp(NOW, [
      ['/v2/reference/news', { status: 403, body: notEntitled.body }],
    ]);
    const run = await runNewsJob({
      http,
      cfg: massive,
      store: fakeStore().store,
      now: () => NOW,
      tickers: ['NVDA'],
    });
    expect(run.error).toBe('News failed: NVDA: Requires a higher Massive plan (not-entitled)');
  });
});

describe('runStudyDataJob on the real NVDA short data and dividends', () => {
  const routes = [
    ['/stocks/v1/short-interest', { status: 200, body: shortInterest.body }],
    ['/stocks/v1/short-volume', { status: 200, body: shortVolume.body }],
    ['/stocks/v1/dividends', { status: 200, body: dividends.body }],
  ] as const;
  it('stores all three data sets per ticker and says how many rows of each', async () => {
    const { store, log } = fakeStore();
    const { http, urls } = routedHttp(NOW, routes);
    const run = await runStudyDataJob({
      http,
      cfg: massive,
      store,
      now: () => NOW,
      tickers: ['NVDA'],
    });
    expect(run.status).toBe('ok');
    expect(run.details).toMatchObject({
      shortInterest: shortInterest.body.results.length,
      shortVolume: shortVolume.body.results.length,
      dividends: dividends.body.results.length,
    });
    expect(urls[0]).toContain('settlement_date.gte=2025-11-24'); // one year back
    expect(urls[1]).toContain('date.gte=2026-07-27'); // 120 days back
    expect(log.statuses[0]).toMatchObject({ source: 'massive_study', state: 'live' });
  });
  it('treats an empty answer (an ETF, a company with no dividend) as normal and a failed request as an error', async () => {
    const empty = { status: 'OK', results: [] };
    const ok = await runStudyDataJob({
      http: routedHttp(NOW, [['/stocks/v1/', { status: 200, body: empty }]]).http,
      cfg: massive,
      store: fakeStore().store,
      now: () => NOW,
      tickers: ['SPY'],
    });
    expect(ok.status).toBe('ok');
    const bad = await runStudyDataJob({
      http: routedHttp(NOW, [
        ['/stocks/v1/short-volume', { status: 403, body: notEntitled.body }],
        ...routes.filter((r) => !r[0].includes('short-volume')),
      ]).http,
      cfg: massive,
      store: fakeStore().store,
      now: () => NOW,
      tickers: ['NVDA'],
    });
    expect(bad.error).toBe(
      'Study data failed: short volume NVDA: Requires a higher Massive plan (not-entitled)',
    );
  });
});

describe('runSectionsJob on the real NVIDIA 10-K sections', () => {
  const route = ['/stocks/filings/10-K/vX/sections', { status: 200, body: sections.body }] as const;
  const businessRoute = ['section=business', { status: 200, body: business.body }] as const;
  it('stores both annual reports, the newest business section, and marks the source live', async () => {
    const { store, log } = fakeStore();
    const { http, urls } = routedHttp(NOW, [businessRoute, route]);
    const run = await runSectionsJob({
      http,
      cfg: massive,
      store,
      now: () => NOW,
      tickers: ['NVDA'],
    });
    expect(run.status).toBe('ok');
    expect(run.rows_written).toBe(3);
    expect(urls[0]).toContain('ticker=NVDA&section=risk_factors&limit=2');
    expect(urls[1]).toContain('ticker=NVDA&section=business&limit=1');
    // The real NVIDIA fiscal 2026 business section (recorded 2026-11-25), stored as filed.
    expect(
      log.annualSections[1]?.map((x) => [x.section, x.periodEnd, x.filingDate, x.text.length]),
    ).toEqual([['business', '2026-01-25', '2026-02-25', 48289]]);
    expect(log.annualSections[1]?.[0]?.text.startsWith('Item 1. Business')).toBe(true);
    expect(log.annualSections[0]?.map((x) => [x.periodEnd, x.filingDate, x.text.length])).toEqual([
      ['2026-01-25', '2026-02-25', 114916],
      ['2025-01-26', '2025-02-26', 110844],
    ]);
    expect(run.details).toMatchObject({ periodEnds: { NVDA: ['2026-01-25', '2025-01-26'] } });
    expect(log.statuses[0]).toMatchObject({ source: 'massive_sections', state: 'live' });
  });
  it('lists a company with no annual report from the vendor instead of failing or hiding it', async () => {
    const { store, log } = fakeStore();
    const { http } = routedHttp(NOW, [
      businessRoute,
      ['ticker=NVDA', { status: 200, body: sections.body }],
      ['ticker=ZZZ', { status: 200, body: { status: 'OK', results: [] } }],
    ]);
    const run = await runSectionsJob({
      http,
      cfg: massive,
      store,
      now: () => NOW,
      tickers: ['NVDA', 'ZZZ'],
    });
    expect(run.status).toBe('ok');
    expect(run.details).toMatchObject({ noAnnualReport: ['ZZZ'] });
    expect(log.statuses[0]?.note).toContain('1 of 2 companies; no 10-K from the vendor for ZZZ');
  });
  it('names a ticker the vendor refused and does not mark the source live', async () => {
    const { store, log } = fakeStore();
    const { http } = routedHttp(NOW, [
      ['/stocks/filings/10-K/', { status: 403, body: notEntitled.body }],
    ]);
    const run = await runSectionsJob({
      http,
      cfg: massive,
      store,
      now: () => NOW,
      tickers: ['NVDA'],
    });
    expect(run.status).toBe('error');
    expect(run.error).toBe('Sections failed: NVDA: Requires a higher Massive plan (not-entitled)');
    expect(log.statuses).toEqual([]);
    expect(log.annualSections).toEqual([]);
  });
  it('asks only for stocks by default: an ETF has no 10-K', async () => {
    const { store } = fakeStore();
    const { http, urls } = routedHttp(NOW, [
      ['/stocks/filings/10-K/', { status: 200, body: { results: [] } }],
    ]);
    await runSectionsJob({ http, cfg: massive, store, now: () => NOW });
    // No stored report, so no business request either: one call per stock.
    expect(urls).toHaveLength(STARTING_STOCKS.length);
    expect(urls.some((u) => /ticker=(SPY|QQQ|IWM|DIA)&/.test(u))).toBe(false);
  });
});
