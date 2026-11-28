import { describe, expect, it } from 'vitest';
import reply from '../../../fixtures/openfigi/mapping-cusip-isin-equity.json';
import {
  figiBatches,
  figiRetryDelayMs,
  parseFigiMapping,
  type FigiJob,
  type FigiReply,
} from './openfigi.js';

// Real reply recorded 2026-11-28 (US listings, equity only): CUSIPs of Apple, Berkshire B, a CUSIP that does not
// exist, Alphabet A and Alphabet C; then ISINs of Microsoft and a malformed ISIN (OpenFIGI: "Invalid idValue format.").
const recorded = reply as FigiReply[];
const job = (idType: FigiJob['idType'], idValue: string): FigiJob => ({
  idType,
  idValue,
  exchCode: 'US',
  marketSecDes: 'Equity',
});
const recordedJobs = [
  job('ID_CUSIP', '037833100'),
  job('ID_CUSIP', '084670702'),
  job('ID_CUSIP', '000000000'),
  job('ID_CUSIP', '02079K305'),
  job('ID_CUSIP', '02079K107'),
  job('ID_ISIN', 'US5949181045'),
  job('ID_ISIN', 'US0000000000'),
];

describe('figiBatches', () => {
  it('sends distinct well-formed CUSIPs, US equity listings only, at most 10 jobs a request', () => {
    const many = Array.from({ length: 23 }, (_, i) => String(100000000 + i));
    const b = figiBatches([...many, many[0] as string, 'bad', ' 037833100 '.toLowerCase()]);
    expect(b.map((x) => x.length)).toEqual([10, 10, 4]);
    expect(b[0]?.[0]).toEqual(job('ID_CUSIP', '100000000'));
    expect(b.flat().filter((j) => j.idValue === '037833100')).toHaveLength(1);
  });

  it('takes 100 jobs a request with a key, and ISINs by their own format', () => {
    const many = Array.from({ length: 150 }, (_, i) => String(100000000 + i));
    expect(figiBatches(many, 100).map((x) => x.length)).toEqual([100, 50]);
    expect(figiBatches(['us5949181045', 'US594918104', '037833100'], 10, 'ID_ISIN')).toEqual([
      [job('ID_ISIN', 'US5949181045')],
    ]);
  });
});

describe('parseFigiMapping on the recorded reply', () => {
  it('maps each identifier to its one US ticker and composite FIGI; unknown and malformed ones stay out', () => {
    const m = parseFigiMapping(recordedJobs, recorded);
    expect(Object.fromEntries(m)).toEqual({
      '037833100': { ticker: 'AAPL', figi: 'BBG000B9XRY4' },
      '084670702': { ticker: 'BRK.B', figi: 'BBG000DWG505' },
      '02079K305': { ticker: 'GOOGL', figi: 'BBG009S39JX6' },
      '02079K107': { ticker: 'GOOG', figi: 'BBG009S3NB30' },
      US5949181045: { ticker: 'MSFT', figi: 'BBG000BPH459' },
    });
  });

  it('leaves an identifier out when the US listings name two tickers, or the item is not equity', () => {
    const jobs = [job('ID_CUSIP', '111111111'), job('ID_CUSIP', '222222222')];
    const m = parseFigiMapping(jobs, [
      {
        data: [
          { ticker: 'AAA', exchCode: 'US', marketSector: 'Equity' },
          { ticker: 'BBB', exchCode: 'US', marketSector: 'Equity' },
        ],
      },
      { data: [{ ticker: 'CCC', exchCode: 'US', marketSector: 'Corp' }] },
    ]);
    expect(m.size).toBe(0);
  });

  it('keeps the ticker but drops the FIGI when listings disagree on it', () => {
    const m = parseFigiMapping(
      [job('ID_CUSIP', '333333333')],
      [
        {
          data: [
            {
              ticker: 'DDD',
              exchCode: 'US',
              marketSector: 'Equity',
              compositeFIGI: 'BBG000000001',
            },
            {
              ticker: 'DDD',
              exchCode: 'US',
              marketSector: 'Equity',
              compositeFIGI: 'BBG000000002',
            },
          ],
        },
      ],
    );
    expect(m.get('333333333')).toEqual({ ticker: 'DDD', figi: null });
  });

  it('refuses a reply whose length does not match the jobs', () => {
    expect(() => parseFigiMapping(recordedJobs, recorded.slice(1))).toThrow(/6 replies for 7 jobs/);
  });
});

describe('figiRetryDelayMs', () => {
  it('waits for retry-after once on 429, backs off on 500 and 503, and stops on anything else', () => {
    expect(figiRetryDelayMs(429, '7', 0)).toBe(7500);
    expect(figiRetryDelayMs(429, null, 0)).toBe(60500);
    expect(figiRetryDelayMs(429, '999', 0)).toBe(120500);
    expect(figiRetryDelayMs(429, '7', 1)).toBeNull();
    expect([0, 1, 2, 3].map((a) => figiRetryDelayMs(503, null, a))).toEqual([
      2000,
      4000,
      8000,
      null,
    ]);
    expect(figiRetryDelayMs(500, null, 0)).toBe(2000);
    expect(figiRetryDelayMs(401, null, 0)).toBeNull();
    expect(figiRetryDelayMs(413, null, 0)).toBeNull();
  });
});
