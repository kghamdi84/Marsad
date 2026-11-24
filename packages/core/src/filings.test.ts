import { describe, expect, it } from 'vitest';
import nvda from '../../../fixtures/sec/submissions-NVDA-trimmed.json';
import {
  EIGHT_K_ITEMS,
  TRANSACTION_CODES,
  describeEightK,
  disclosureLag,
  explainTransactionCode,
  formLabel,
} from './filings.js';

describe('the 8-K item table', () => {
  it('has every item of the SEC form: 33 items in 9 sections, keyed by their own number', () => {
    const keys = Object.keys(EIGHT_K_ITEMS);
    expect(keys).toHaveLength(33);
    for (const [k, v] of Object.entries(EIGHT_K_ITEMS)) expect(v.item).toBe(k);
    const perSection = (s: string) => keys.filter((k) => k.startsWith(`${s}.`)).length;
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map((s) => perSection(String(s)))).toEqual([
      5, 6, 3, 2, 8, 6, 1, 1, 1,
    ]);
  });

  it('matches the materiality the brief names, and marks every other item as this project’s default', () => {
    const fromBrief = (m: string) =>
      Object.values(EIGHT_K_ITEMS)
        .filter((i) => i.basis === 'brief' && i.materiality === m)
        .map((i) => i.item)
        .sort();
    expect(fromBrief('high')).toEqual(['1.05', '2.02', '2.06', '3.01', '4.01', '4.02', '5.02']);
    expect(fromBrief('medium')).toEqual(['1.01', '1.02', '2.01', '2.05']);
    expect(fromBrief('low')).toEqual(['7.01', '8.01', '9.01']);
    const defaults = Object.values(EIGHT_K_ITEMS).filter((i) => i.basis === 'marsad-default');
    expect(defaults).toHaveLength(33 - 14);
  });

  it('uses the SEC’s official titles, including the long ones', () => {
    expect(EIGHT_K_ITEMS['2.02']?.officialTitle).toBe(
      'Results of Operations and Financial Condition',
    );
    expect(EIGHT_K_ITEMS['4.02']?.officialTitle).toBe(
      'Non-Reliance on Previously Issued Financial Statements or a Related Audit Report or Completed Interim Review',
    );
    expect(EIGHT_K_ITEMS['3.01']?.officialTitle).toBe(
      'Notice of Delisting or Failure to Satisfy a Continued Listing Rule or Standard; Transfer of Listing',
    );
  });
});

describe('describeEightK', () => {
  it('takes the highest materiality among the items', () => {
    expect(describeEightK(['9.01', '2.02']).materiality).toBe('high');
    expect(describeEightK(['1.01', '9.01']).materiality).toBe('medium');
    expect(describeEightK(['7.01', '9.01']).materiality).toBe('low');
  });
  it('keeps order, removes duplicates and ignores blanks', () => {
    expect(describeEightK(['9.01', '2.02', '9.01', ' ', '']).items.map((i) => i.item)).toEqual([
      '9.01',
      '2.02',
    ]);
  });
  it('reports unknown item numbers instead of dropping them, and never guesses a materiality', () => {
    const r = describeEightK(['10.99']);
    expect(r).toMatchObject({ unknown: ['10.99'], items: [], materiality: 'unknown' });
    expect(describeEightK([]).materiality).toBe('unknown');
    // A known item alongside an unknown one still shows the unknown one.
    expect(describeEightK(['2.02', '10.99'])).toMatchObject({
      materiality: 'high',
      unknown: ['10.99'],
    });
  });
  it('labels the real NVIDIA 8-K filed 2026-11-23 (items 5.02 and 9.01) as high materiality', () => {
    const recent = nvda.body.filings.recent;
    const i = recent.accessionNumber.indexOf('0001045810-26-000090');
    const items = String(recent.items[i]).split(',');
    const r = describeEightK(items);
    expect(r.items.map((x) => x.plain)).toEqual([
      'Executive or director change',
      'Attached documents and exhibits',
    ]);
    expect(r.materiality).toBe('high');
  });
});

describe('Form 4 transaction codes', () => {
  it('explains the codes the brief asks for', () => {
    for (const code of ['P', 'S', 'A', 'M', 'X', 'F', 'G', 'D'])
      expect(TRANSACTION_CODES[code], code).toBeDefined();
    expect(explainTransactionCode('P')).toMatchObject({ kind: 'discretionary', known: true });
    expect(explainTransactionCode('F').meaning).toContain('tax liability');
  });
  it('only open-market purchases and sales count as the insider’s own decision', () => {
    const discretionary = Object.values(TRANSACTION_CODES)
      .filter((c) => c.kind === 'discretionary')
      .map((c) => c.code)
      .sort();
    expect(discretionary).toEqual(['P', 'S']);
  });
  it('is case-insensitive and never invents a meaning for a code it does not have', () => {
    expect(explainTransactionCode('p').code).toBe('P');
    expect(explainTransactionCode('Z')).toMatchObject({
      known: false,
      kind: 'unexplained',
      meaning: "Code Z: see the SEC's Form 4 instructions",
    });
  });
  it('records where code X comes from, because the SEC bulletin does not list it', () => {
    expect(TRANSACTION_CODES['X']?.source).toBe('brief');
    expect(TRANSACTION_CODES['P']?.source).toBe('sec-bulletin');
  });
});

describe('disclosure lags and form names', () => {
  it('labels Form 4 as two business days and 13F as a 45-day lag', () => {
    expect(disclosureLag('4')?.label).toContain('two business days');
    expect(disclosureLag('13F-HR')?.label).toContain('45-day reporting lag');
    expect(disclosureLag('8-K')?.label).toContain('four business days');
  });
  it('treats an amendment like its base form and returns null for unknown forms', () => {
    expect(disclosureLag('4/A')).toEqual(disclosureLag('4'));
    expect(disclosureLag('S-1')).toBeNull();
  });
  it('names forms in plain words and falls back to the code', () => {
    expect(formLabel('4')).toBe('Insider transaction (Form 4)');
    expect(formLabel('8-K/A')).toBe('Current report (8-K), amended');
    expect(formLabel('424B2')).toBe('424B2');
  });
});
