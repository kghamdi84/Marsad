import { describe, expect, it } from 'vitest';
import { etfOverlap, lookThrough, matchTickers, parseNport } from './nport.js';

const xml = (
  rows: string,
) => `<edgarSubmission><formData><genInfo><repPdDate>2026-06-30</repPdDate></genInfo>
<fundInfo><netAssets>1000.00</netAssets></fundInfo><invstOrSecs>${rows}</invstOrSecs></formData></edgarSubmission>`;
const row = (name: string, cusip: string, pct: number, val: number, cat = 'EC') =>
  `<invstOrSec><name>${name}</name><cusip>${cusip}</cusip><identifiers><isin value="US${cusip}0"/></identifiers><valUSD>${val}</valUSD><pctVal>${pct}</pctVal><assetCat>${cat}</assetCat></invstOrSec>`;

describe('parseNport', () => {
  it('reads each holding with its weight as a fraction (N-PORT reports percent)', () => {
    const r = parseNport(
      xml(row('NVIDIA Corp', '67066G104', 7.5, 75) + row('AT&amp;T Inc', '00206R102', 0.5, 5)),
    );
    expect(r.reportDate).toBe('2026-06-30');
    expect(r.netAssets).toBe(1000);
    expect(r.holdings).toEqual([
      {
        name: 'NVIDIA Corp',
        cusip: '67066G104',
        isin: 'US67066G1040',
        weight: 0.075,
        valueUsd: 75,
        assetCat: 'EC',
      },
      {
        name: 'AT&T Inc',
        cusip: '00206R102',
        isin: 'US00206R1020',
        weight: 0.005,
        valueUsd: 5,
        assetCat: 'EC',
      },
    ]);
  });
  it('refuses a document without holdings or with a non-numeric weight', () => {
    expect(() => parseNport('<x/>')).toThrow('N-PORT document has no holdings');
    expect(() => parseNport(xml(row('X', '000000000', Number.NaN, 1)))).toThrow(
      /no numeric value or weight/,
    );
  });
});

describe('matchTickers', () => {
  const companies = [
    { ticker: 'NVDA', name: 'NVIDIA CORP' },
    { ticker: 'GOOGL', name: 'Alphabet Inc.' },
    { ticker: 'GOOG', name: 'Alphabet Inc.' },
  ];
  const h = (name: string, cusip: string, assetCat = 'EC') => ({
    name,
    cusip,
    isin: null,
    weight: 0.01,
    valueUsd: 1,
    assetCat,
  });
  it('matches by company name, leaves a shared name unmatched unless the CUSIP is known, and skips non-equity', () => {
    expect(
      matchTickers(
        [
          h('NVIDIA Corp', '67066G104'),
          h('Alphabet Inc', '02079K305'),
          h('Alphabet Inc', '02079K107'),
          h('NVIDIA Corp', 'XXXXXXXXX', 'DBT'),
        ],
        companies,
        new Map([['02079K305', 'GOOGL']]),
      ),
    ).toEqual(['NVDA', 'GOOGL', null, null]);
  });
});

describe('etfOverlap', () => {
  it('sums the smaller weight of each shared security', () => {
    // Shared: A (0.5 vs 0.2 -> 0.2) and B (0.3 vs 0.6 -> 0.3); C and D are not shared: overlap 0.5.
    const a = [
      { cusip: 'A', weight: 0.5 },
      { cusip: 'B', weight: 0.3 },
      { cusip: 'C', weight: 0.2 },
    ];
    const b = [
      { cusip: 'A', weight: 0.2 },
      { cusip: 'B', weight: 0.6 },
      { cusip: 'D', weight: 0.2 },
    ];
    expect(etfOverlap(a, b)).toBeCloseTo(0.5, 12);
    expect(etfOverlap(a, a)).toBeCloseTo(1, 12);
    expect(etfOverlap(a, [{ cusip: 'Z', weight: 1 }])).toBe(0);
  });
});

describe('lookThrough', () => {
  it('adds what each fund holds of a stock to the direct position', () => {
    // NVDA: 1,000 direct + 10,000 of QQQ at 9% (900) + 5,000 of SPY at 7% (350) = 2,250.
    const rows = lookThrough(
      [
        { ticker: 'NVDA', value: 1000 },
        { ticker: 'QQQ', value: 10000 },
        { ticker: 'SPY', value: 5000 },
        { ticker: 'RKLB', value: 400 },
      ],
      new Map([
        ['QQQ', new Map([['NVDA', 0.09]])],
        ['SPY', new Map([['NVDA', 0.07]])],
      ]),
    );
    expect(rows).toEqual([
      {
        ticker: 'NVDA',
        direct: 1000,
        viaEtfs: [
          { etf: 'QQQ', usd: 900 },
          { etf: 'SPY', usd: 350.00000000000006 },
        ],
        total: 2250,
      },
      { ticker: 'RKLB', direct: 400, viaEtfs: [], total: 400 },
    ]);
  });
});
