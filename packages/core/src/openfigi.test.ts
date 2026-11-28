import { describe, expect, it } from 'vitest';
import reply from '../../../fixtures/openfigi/mapping-cusip-us.json';
import { figiBatches, parseFigiMapping, type FigiReply } from './openfigi.js';

// Real reply recorded 2026-11-28 for Apple, Berkshire B, a CUSIP that does not exist, Alphabet A and Alphabet C.
const recorded = reply as FigiReply[];
const cusips = ['037833100', '084670702', '000000000', '02079K305', '02079K107'];

describe('figiBatches', () => {
  it('sends distinct valid CUSIPs, US listings only, at most 10 jobs a request', () => {
    const many = Array.from({ length: 23 }, (_, i) => String(100000000 + i));
    const b = figiBatches([...many, many[0] as string, 'bad', ' 037833100 '.toLowerCase()]);
    expect(b.map((x) => x.length)).toEqual([10, 10, 4]);
    expect(b[0]?.[0]).toEqual({ idType: 'ID_CUSIP', idValue: '100000000', exchCode: 'US' });
    expect(b.flat().filter((j) => j.idValue === '037833100')).toHaveLength(1);
  });
});

describe('parseFigiMapping on the recorded reply', () => {
  it('maps each CUSIP to its one US ticker, share classes with a dot, and leaves unknown CUSIPs out', () => {
    const [jobs] = figiBatches(cusips);
    const m = parseFigiMapping(jobs ?? [], recorded);
    expect(Object.fromEntries(m)).toEqual({
      '037833100': 'AAPL',
      '084670702': 'BRK.B',
      '02079K305': 'GOOGL',
      '02079K107': 'GOOG',
    });
  });

  it('leaves a CUSIP out when the US listings name two tickers, or the item is not equity', () => {
    const jobs = figiBatches(['111111111', '222222222'])[0] ?? [];
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

  it('refuses a reply whose length does not match the jobs', () => {
    const jobs = figiBatches(cusips)[0] ?? [];
    expect(() => parseFigiMapping(jobs, recorded.slice(1))).toThrow(/4 replies for 5 jobs/);
  });
});
