import { describe, expect, it } from 'vitest';
import gp from '../../../../fixtures/sec/sec-frame-GrossProfit-CY2025.json';
import ni from '../../../../fixtures/sec/sec-frame-NetIncomeLoss-CY2025.json';
import cfo from '../../../../fixtures/sec/sec-frame-NetCashProvidedByUsedInOperatingActivities-CY2025.json';
import assets from '../../../../fixtures/sec/sec-frame-Assets-CY2025Q4I.json';
import liab from '../../../../fixtures/sec/sec-frame-Liabilities-CY2025Q4I.json';
import eq from '../../../../fixtures/sec/sec-frame-StockholdersEquity-CY2025Q4I.json';
import dei from '../../../../fixtures/sec/sec-frame-EntityCommonStockSharesOutstanding-CY2025Q4I.json';
import cso from '../../../../fixtures/sec/sec-frame-CommonStockSharesOutstanding-CY2025Q4I.json';
import rev from '../../../../fixtures/sec/sec-frame-RevenueFromContractWithCustomerExcludingAssessedTax-CY2025.json';
import revs from '../../../../fixtures/sec/sec-frame-Revenues-CY2025.json';
import cor from '../../../../fixtures/sec/sec-frame-CostOfRevenue-CY2025.json';
import cogs from '../../../../fixtures/sec/sec-frame-CostOfGoodsAndServicesSold-CY2025.json';
import pl from '../../../../fixtures/sec/sec-frame-ProfitLoss-CY2025.json';
import eqnci from '../../../../fixtures/sec/sec-frame-StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest-CY2025Q4I.json';
import diluted from '../../../../fixtures/sec/sec-frame-WeightedAverageNumberOfDilutedSharesOutstanding-CY2025.json';
import tickers from '../../../../fixtures/sec/sec-company-tickers.json';
import { HttpClient, TokenBucket, type Clock } from '../http.js';
import {
  assembleQualityInputs,
  qualityFrameYear,
  framePeriod,
  QUALITY_FRAMES,
} from '../quality.js';
import { fetchFrame, parseFrame } from './sec-frames.js';
import { parseCompanyTickers } from './sec.js';

const files: Record<string, { body: unknown }> = {
  GrossProfit: gp,
  NetIncomeLoss: ni,
  NetCashProvidedByUsedInOperatingActivities: cfo,
  Assets: assets,
  Liabilities: liab,
  StockholdersEquity: eq,
  EntityCommonStockSharesOutstanding: dei,
  CommonStockSharesOutstanding: cso,
  RevenueFromContractWithCustomerExcludingAssessedTax: rev,
  Revenues: revs,
  CostOfRevenue: cor,
  CostOfGoodsAndServicesSold: cogs,
  ProfitLoss: pl,
  StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest: eqnci,
  WeightedAverageNumberOfDilutedSharesOutstanding: diluted,
};
const frames = Object.fromEntries(
  Object.entries(files).map(([k, f]) => [
    k,
    new Map(parseFrame(f.body).map((r) => [r.cik, r.value])),
  ]),
);
const val = (concept: string, cik: string) => frames[concept]?.get(cik);

describe('parseFrame on real SEC frames (recorded 2026-11-25)', () => {
  it('reads every kept row with a 10-digit CIK, a number and a date', () => {
    const rows = parseFrame(gp.body);
    expect(rows).toHaveLength(6);
    const nvda = rows.find((r) => r.cik === '0001045810');
    expect(nvda).toMatchObject({ entityName: 'NVIDIA CORP', value: 153463000000 });
    expect(nvda?.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('refuses a body without data or with a non-numeric value', () => {
    expect(() => parseFrame({})).toThrow('frame has no data array');
    expect(() => parseFrame({ data: [{ cik: 1, val: 'x', end: '2025-12-31' }] })).toThrow(
      /not a number/,
    );
  });
});

describe('assembleQualityInputs on real SEC frames', () => {
  const t = parseCompanyTickers(tickers.body);
  const pick = (k: string) => {
    const c = t.get(k);
    if (!c) throw new Error(`no ${k}`);
    return { ticker: k, cik: c.cik, name: c.name };
  };
  const rows = assembleQualityInputs(
    frames,
    ['AAPL', 'WMT', 'KO', 'F', 'BAC', 'T'].map(pick),
    new Map([['AAPL', 200]]),
  );
  const row = (k: string) => rows.find((r) => r.ticker === k);

  it('uses the tagged figures when they exist (Apple: no fallback)', () => {
    expect(row('AAPL')).toMatchObject({
      grossProfit: 195201000000,
      netIncome: 112010000000,
      shares: 14681140000,
      price: 200,
      notes: [],
    });
  });
  it('computes Walmart gross profit as revenue minus cost of goods, and liabilities as assets minus equity', () => {
    const cik = pick('WMT').cik;
    const revenue =
      val('RevenueFromContractWithCustomerExcludingAssessedTax', cik) ?? val('Revenues', cik);
    const cost = val('CostOfRevenue', cik) ?? val('CostOfGoodsAndServicesSold', cik);
    expect(row('WMT')?.grossProfit).toBe((revenue as number) - (cost as number));
    expect(row('WMT')?.grossProfit).toBe(171018000000);
    expect(row('WMT')?.liabilities).toBe(284668000000 - 99617000000);
    expect(row('WMT')?.notes).toEqual([
      'gross profit = revenue minus cost of revenue',
      'liabilities = assets minus equity',
    ]);
  });
  it('falls back to diluted weighted shares (Coca-Cola) and to ProfitLoss (Ford), and says so', () => {
    expect(row('KO')?.shares).toBe(4313000000);
    expect(row('KO')?.notes).toContain('shares = diluted weighted average for the year');
    expect(row('F')?.netIncome).toBe(-8162000000);
    expect(row('F')?.notes).toContain('net income includes noncontrolling interest (ProfitLoss)');
  });
  it('leaves gross profit empty when nothing reports it (a bank, a telecom), so the screen excludes them', () => {
    expect(row('BAC')?.grossProfit).toBeNull();
    expect(row('T')?.grossProfit).toBeNull();
    expect(row('T')?.notes).toContain('equity includes noncontrolling interest');
  });
});

describe('frame periods', () => {
  it('uses last year from April and the year before until then', () => {
    expect(qualityFrameYear('2026-11-25')).toBe(2025);
    expect(qualityFrameYear('2026-04-01')).toBe(2025);
    expect(qualityFrameYear('2026-03-31')).toBe(2024);
  });
  it('reads balance sheets at the year end and flows over the year', () => {
    const assetsSpec = QUALITY_FRAMES.find((f) => f.concept === 'Assets');
    const gpSpec = QUALITY_FRAMES.find((f) => f.concept === 'GrossProfit');
    expect(assetsSpec && framePeriod(assetsSpec, 2025)).toBe('CY2025Q4I');
    expect(gpSpec && framePeriod(gpSpec, 2025)).toBe('CY2025');
  });
});

describe('fetchFrame', () => {
  it('asks data.sec.gov with the declared User-Agent and reads the body', async () => {
    const calls: { url: string; ua: string | undefined }[] = [];
    const clock: Clock = { now: () => 0, sleep: () => Promise.resolve() };
    const http = new HttpClient({
      fetch: (url, init) => {
        calls.push({ url, ua: init?.headers?.['User-Agent'] });
        return Promise.resolve({
          status: 200,
          headers: { get: () => null },
          text: () => Promise.resolve(JSON.stringify(gp.body)),
        });
      },
      clock,
      bucket: new TokenBucket(100, 100, clock),
      maxRetries: 0,
    });
    const r = await fetchFrame(
      http,
      {
        userAgent: 'Marsad research test@example.com',
        now: () => new Date('2026-11-25T00:00:00Z'),
      },
      'us-gaap',
      'GrossProfit',
      'USD',
      'CY2025',
    );
    expect(calls[0]).toEqual({
      url: 'https://data.sec.gov/api/xbrl/frames/us-gaap/GrossProfit/USD/CY2025.json',
      ua: 'Marsad research test@example.com',
    });
    expect(r.ok && r.data.value).toHaveLength(6);
  });
  it('refuses a malformed concept or period before any request', async () => {
    const clock: Clock = { now: () => 0, sleep: () => Promise.resolve() };
    const http = new HttpClient({
      fetch: () => Promise.reject(new Error('should not be called')),
      clock,
      bucket: new TokenBucket(100, 100, clock),
      maxRetries: 0,
    });
    const cfg = { userAgent: 'Marsad research test@example.com', now: () => new Date() };
    await expect(fetchFrame(http, cfg, 'us-gaap', 'Gross/Profit', 'USD', 'CY2025')).rejects.toThrow(
      /Not a frame/,
    );
  });
});
