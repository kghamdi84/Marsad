import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { ETF_VERSION, etfOverlap, type JobRunRecord, type NportReport } from '@marsad/core';
import { routedHttp } from './test-http.js';
import { runEtfJob, type EtfStore } from './etf-job.js';

const NOW = new Date('2026-11-29T09:50:00Z');
const dir = new URL('../../fixtures/sec/nport/', import.meta.url).pathname;
const fixtures = readdirSync(dir).map(
  (f) =>
    JSON.parse(readFileSync(dir + f, 'utf8')) as {
      etf: string;
      cik: number;
      accession: string;
      filingDate: string;
      reportDate: string;
      gzipBase64: string;
    },
);
const tickers = (
  JSON.parse(
    readFileSync(
      new URL('../../fixtures/sec/sec-company-tickers.json', import.meta.url).pathname,
      'utf8',
    ),
  ) as { body: unknown }
).body;
const sec = { userAgent: 'Marsad research test@example.com', now: () => NOW };

// Minimal submissions bodies: one NPORT-P per trust, as the SEC lists it.
const submissions = (f: (typeof fixtures)[number]) => ({
  filings: {
    recent: {
      accessionNumber: [f.accession],
      form: ['NPORT-P'],
      filingDate: [f.filingDate],
      acceptanceDateTime: [`${f.filingDate}T16:00:00.000Z`],
      primaryDocument: ['xslFormNPORT-P_X01/primary_doc.xml'],
      items: [''],
    },
  },
});

function memory(stored: string[] = [], version = ETF_VERSION) {
  const saved: { etf: string; report: NportReport; tickers: (string | null)[] }[] = [];
  const runs: JobRunRecord[] = [];
  const store: EtfStore = {
    getStoredAccessions: () => Promise.resolve(new Map(stored.map((a) => [a, version]))),
    saveEtfReport: (etf, _acc, report, t) => {
      saved.push({ etf, report, tickers: [...t] });
      return Promise.resolve(report.holdings.length);
    },
    recordRun: (r) => {
      runs.push(r);
      return Promise.resolve();
    },
  };
  return { store, saved, runs };
}

const routes = () => [
  ['company_tickers.json', { status: 200, body: tickers }] as const,
  ...fixtures.flatMap((f) => [
    [`CIK${String(f.cik).padStart(10, '0')}.json`, { status: 200, body: submissions(f) }] as const,
    [
      `/${f.cik}/${f.accession.replace(/-/g, '')}/primary_doc.xml`,
      { status: 200, body: gunzipSync(Buffer.from(f.gzipBase64, 'base64')).toString('utf8') },
    ] as const,
  ]),
];

describe('runEtfJob on real N-PORT reports (SPY and QQQ for June 2026, DIA for July 2026)', () => {
  it('stores every holding with its weight; overlaps match an independent Python calculation', async () => {
    const m = memory();
    const { http, urls } = routedHttp(NOW, routes());
    const run = await runEtfJob({ http, sec, store: m.store, now: () => NOW });
    expect(run.status).toBe('ok');
    expect(urls.some((u) => u.endsWith('/primary_doc.xml') && !u.includes('xsl'))).toBe(true);
    const by = (etf: string) => m.saved.find((s) => s.etf === etf);
    expect(by('SPY')?.report.holdings).toHaveLength(504);
    expect(by('QQQ')?.report.reportDate).toBe('2026-06-30');
    expect(by('DIA')?.report.reportDate).toBe('2026-07-31');
    // NVIDIA by CUSIP: 7.517% of SPY, 7.597% of QQQ (Python, same files).
    const nv = (etf: string) =>
      by(etf)
        ?.report.holdings.filter((h) => h.cusip === '67066G104')
        .reduce((a, h) => a + h.weight, 0);
    expect(nv('SPY')).toBeCloseTo(0.07517, 5);
    expect(nv('QQQ')).toBeCloseTo(0.075968, 6);
    // And matched to its ticker by name against the SEC list.
    const spy = by('SPY');
    const i = spy?.report.holdings.findIndex((h) => h.cusip === '67066G104') ?? -1;
    expect(spy?.tickers[i]).toBe('NVDA');
    const h = (etf: string) => by(etf)?.report.holdings ?? [];
    expect(etfOverlap(h('SPY'), h('QQQ'))).toBeCloseTo(0.537109, 6);
    expect(etfOverlap(h('SPY'), h('DIA'))).toBeCloseTo(0.279772, 6);
    expect(etfOverlap(h('QQQ'), h('DIA'))).toBeCloseTo(0.2018, 6);
    expect(run.details).toMatchObject({ notCovered: ['IWM (multi-fund trust)'] });
  });

  it('downloads nothing for a report already stored', async () => {
    const m = memory(fixtures.map((f) => f.accession));
    const { http, urls } = routedHttp(NOW, routes());
    await runEtfJob({ http, sec, store: m.store, now: () => NOW });
    expect(urls.filter((u) => u.includes('/Archives/'))).toEqual([]);
    expect(m.saved).toEqual([]);
  });

  it('downloads a stored report again when it was matched under an older version', async () => {
    const m = memory([fixtures[0]?.accession as string], 'etf-1');
    const { http, urls } = routedHttp(NOW, routes());
    await runEtfJob({ http, sec, store: m.store, now: () => NOW });
    expect(urls.filter((u) => u.includes('/Archives/'))).toHaveLength(fixtures.length);
  });

  it('matches by CUSIP through OpenFIGI first, by name only where it has no answer', async () => {
    const spy = fixtures.find((f) => f.etf === 'SPY');
    const named = memory();
    await runEtfJob({
      http: routedHttp(NOW, routes()).http,
      sec,
      store: named.store,
      now: () => NOW,
    });
    const byName = named.saved.find((x) => x.etf === 'SPY');
    // A lookup that knows every SPY common-stock CUSIP: each one gets a ticker of its own.
    const figi = (cusips: readonly string[]) =>
      Promise.resolve(new Map(cusips.map((c, i) => [c, `T${String(i).padStart(4, '0')}`])));
    const m = memory();
    const run = await runEtfJob({
      http: routedHttp(NOW, routes()).http,
      sec,
      store: m.store,
      now: () => NOW,
      figi,
    });
    const s = m.saved.find((x) => x.etf === 'SPY');
    expect(spy && s && byName).toBeTruthy();
    const equity = s?.report.holdings.filter((h) => h.assetCat === 'EC' && h.cusip) ?? [];
    const matched = s?.tickers.filter((t) => t !== null).length ?? 0;
    expect(matched).toBeGreaterThan(byName?.tickers.filter((t) => t !== null).length ?? 0);
    expect(matched).toBe(equity.length);
    const funds = run.details?.['funds'] as Record<string, { byCusip: number; unmatched: number }>;
    expect(funds['SPY']?.byCusip).toBe(equity.length);
  });

  it('falls back to names and says why when OpenFIGI fails', async () => {
    const m = memory();
    const run = await runEtfJob({
      http: routedHttp(NOW, routes()).http,
      sec,
      store: m.store,
      now: () => NOW,
      figi: () => Promise.reject(new Error('OpenFIGI answered 503')),
    });
    expect(run.status).toBe('ok');
    const funds = run.details?.['funds'] as Record<string, { figi?: string; byName: number }>;
    expect(funds['SPY']?.figi).toBe('OpenFIGI failed, names only: OpenFIGI answered 503');
    expect(funds['SPY']?.byName).toBeGreaterThan(0);
  });
});
