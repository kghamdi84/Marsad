import { describe, expect, it } from 'vitest';
import sample from '../../../fixtures/sec/13f/13f-sample.json';
import {
  companyKey,
  holderList,
  isCommonShareLine,
  issuerMatches,
  secDate,
  type Filer,
  type InfoRow,
} from './holders.js';

describe('company keys and issuer matching', () => {
  it.each([
    ['NVIDIA CORP', ['NVIDIA']],
    ['Rocket Lab Corp', ['ROCKET', 'LAB']],
    ['Rocket Lab USA, Inc.', ['ROCKET', 'LAB']],
    ['BigBear.ai Holdings, Inc.', ['BIGBEAR', 'AI']],
    ['MARA Holdings, Inc.', ['MARA']],
    ['Hims & Hers Health, Inc.', ['HIMS', 'AND', 'HERS']],
    ['SoFi Technologies, Inc.', ['SOFI']],
  ])('%s -> %j', (name, key) => expect(companyKey(name)).toEqual(key));

  it('matches whole words only', () => {
    expect(issuerMatches('MARA HOLDINGS INC', ['MARA'])).toBe(true);
    expect(issuerMatches('MARATHON OIL CORP', ['MARA'])).toBe(false);
    expect(issuerMatches('NVIDIA Corp', ['NVIDIA'])).toBe(true);
    expect(issuerMatches('ROCKET LAB USA INC', ['ROCKET', 'LAB'])).toBe(true);
    expect(issuerMatches('ROCKET PHARMACEUTICALS', ['ROCKET', 'LAB'])).toBe(false);
  });

  it('keeps common-share lines and drops options, principal amounts, warrants and notes', () => {
    const line = { titleOfClass: 'COM', putCall: '', amountType: 'SH' };
    expect(isCommonShareLine(line)).toBe(true);
    expect(isCommonShareLine({ ...line, putCall: 'Put' })).toBe(false);
    expect(isCommonShareLine({ ...line, amountType: 'PRN' })).toBe(false);
    expect(isCommonShareLine({ ...line, titleOfClass: '*W EXP 08/25/202' })).toBe(false);
    expect(isCommonShareLine({ ...line, titleOfClass: 'WARRANTS' })).toBe(false);
    expect(isCommonShareLine({ ...line, titleOfClass: 'NOTE 4.250% 2/0' })).toBe(false);
  });

  it('reads SEC dates', () => {
    expect(secDate('30-JUN-2026')).toBe('2026-06-30');
    expect(secDate('2026-06-30')).toBeNull();
  });
});

describe('holderList', () => {
  const filers = new Map<string, Filer>([
    [
      'a1',
      {
        accession: 'a1',
        cik: '1',
        name: 'Fund One',
        period: '2026-06-30',
        filingDate: '2026-08-10',
        type: '13F-HR',
        amendment: false,
      },
    ],
    [
      'a2',
      {
        accession: 'a2',
        cik: '2',
        name: 'Fund Two',
        period: '2026-06-30',
        filingDate: '2026-08-12',
        type: '13F-HR',
        amendment: false,
      },
    ],
    [
      'a3',
      {
        accession: 'a3',
        cik: '3',
        name: 'Late Fund',
        period: '2026-03-31',
        filingDate: '2026-06-02',
        type: '13F-HR',
        amendment: false,
      },
    ],
    [
      'a4',
      {
        accession: 'a4',
        cik: '4',
        name: 'Amender',
        period: '2026-06-30',
        filingDate: '2026-08-20',
        type: '13F-HR',
        amendment: true,
      },
    ],
  ]);
  const row = (accession: string, shares: number, extra: Partial<InfoRow> = {}): InfoRow => ({
    accession,
    issuer: 'ROCKET LAB CORP',
    titleOfClass: 'COM',
    cusip: '773121108',
    value: shares * 50,
    shares,
    amountType: 'SH',
    putCall: '',
    ...extra,
  });

  it('sums each filer, keeps the newest quarter, and counts what it left out', () => {
    const l = holderList(
      [
        row('a1', 600),
        row('a1', 200, { cusip: '773122106', issuer: 'ROCKET LAB USA INC' }),
        row('a2', 200),
        row('a2', 50, { putCall: 'Call' }),
        row('a3', 999),
        row('a4', 777),
      ],
      filers,
    );
    // Fund One 800 of 1,000 shares (80%), Fund Two 200 (20%).
    expect(l?.period).toBe('2026-06-30');
    expect(l?.filers).toBe(2);
    expect(l?.totalShares).toBe(1000);
    expect(l?.totalValueUsd).toBe(50000);
    expect(l?.top.map((h) => [h.name, h.shares, h.share])).toEqual([
      ['Fund One', 800, 0.8],
      ['Fund Two', 200, 0.2],
    ]);
    expect(l?.cusips).toEqual([
      { cusip: '773121108', issuer: 'ROCKET LAB CORP', lines: 2 },
      { cusip: '773122106', issuer: 'ROCKET LAB USA INC', lines: 1 },
    ]);
    expect(l?.leftOut).toEqual({ options: 1, otherPeriod: 1, amendments: 1, notCommon: 0 });
  });

  it('is null when no original report is present', () => {
    expect(holderList([row('a4', 1)], filers)).toBeNull();
  });
});

describe('holderList on the real 13F sample (filings Jun to Aug 2026)', () => {
  const [head, ...lines] = sample.infotable;
  const cols = (head ?? '').split('\t');
  const at = (l: string, c: string) => l.split('\t')[cols.indexOf(c)] ?? '';
  const sub = new Map(
    sample.submission.slice(1).map((l) => {
      const f = l.split('\t');
      return [f[0] ?? '', f] as const;
    }),
  );
  const cover = new Map(
    sample.coverpage.slice(1).map((l) => {
      const f = l.split('\t');
      return [f[0] ?? '', f] as const;
    }),
  );
  const filers = new Map<string, Filer>();
  for (const [acc, s] of sub) {
    const c = cover.get(acc);
    filers.set(acc, {
      accession: acc,
      cik: s[3] ?? '',
      name: c?.[9] ?? '',
      period: secDate(s[4] ?? '') ?? '',
      filingDate: secDate(s[1] ?? '') ?? '',
      type: s[2] ?? '',
      amendment: c?.[2] === 'Y',
    });
  }
  const rows = (key: string[]): InfoRow[] =>
    lines
      .filter((l) => issuerMatches(at(l, 'NAMEOFISSUER'), key))
      .map((l) => ({
        accession: at(l, 'ACCESSION_NUMBER'),
        issuer: at(l, 'NAMEOFISSUER'),
        titleOfClass: at(l, 'TITLEOFCLASS'),
        cusip: at(l, 'CUSIP'),
        value: Number(at(l, 'VALUE')),
        shares: Number(at(l, 'SSHPRNAMT')),
        amountType: at(l, 'SSHPRNAMTTYPE'),
        putCall: at(l, 'PUTCALL'),
      }));

  it('finds NVIDIA under one CUSIP and leaves options out', () => {
    const l = holderList(rows(companyKey('NVIDIA CORP')), filers);
    expect(l?.period).toBe('2026-06-30');
    expect(l?.cusips.map((c) => c.cusip)).toEqual(['67066G104']);
    expect(l?.leftOut.options).toBeGreaterThan(0);
    expect(l?.top[0]?.shares).toBeGreaterThan(0);
    // Shares add up: the listed shares never exceed the total.
    const listed = (l?.top ?? []).reduce((s, h) => s + h.shares, 0);
    expect(listed).toBeLessThanOrEqual(l?.totalShares ?? 0);
  });

  it('counts Rocket Lab under both its new and its pre-redomicile CUSIP, and says so', () => {
    const l = holderList(rows(companyKey('Rocket Lab Corp')), filers);
    expect(l?.cusips.map((c) => c.cusip).sort()).toEqual(['773121108', '773122106']);
  });
});
