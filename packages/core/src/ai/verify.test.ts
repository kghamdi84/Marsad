import { describe, expect, it } from 'vitest';
import type { Payload } from './facts.js';
import { extractNumbers } from './numbers.js';
import { describeIssues, splitSentences, verifyText } from './verify.js';

// A made-up company. The figures exist only to test the verifier.
const payload: Payload = {
  facts: [
    { id: 'F1', label: 'TestCo Q3 FY2026 revenue', value: 4_180_000_000, unit: 'usd' },
    { id: 'F2', label: 'Revenue growth year over year', value: 12.4, unit: 'pct' },
    { id: 'F3', label: 'Gross margin', value: 61, unit: 'pct' },
    { id: 'F4', label: 'Price to earnings', value: 28.4, unit: 'ratio' },
    { id: 'F5', label: 'Share price at close', value: 188.4, unit: 'usd' },
    { id: 'F6', label: 'Insider shares sold, last 90 days', value: 1_250_000, unit: 'shares' },
    { id: 'F7', label: 'Change in operating margin versus prior year', value: -2.5, unit: 'pct' },
    { id: 'F8', label: '8-K item 5.02: executive or director change', value: '5.02', unit: 'text' },
    { id: 'F9', label: 'Filings in the last 30 days', value: 7, unit: 'count' },
  ],
  documents: [{ id: 'D1', title: 'Press release', text: 'TestCo announced results.' }],
};

const kinds = (text: string) => verifyText(text, payload).issues.map((i) => i.kind);

describe('a faithful text passes', () => {
  it('accepts correct figures with the right citations', () => {
    const text =
      'Revenue was $4.18B [F1]. Revenue grew 12.4% year over year [F2]. Gross margin was 61% [F3], and the stock trades at 28.4x earnings [F4].';
    const v = verifyText(text, payload);
    expect(v.issues).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.numbersChecked).toBe(4);
    expect(v.citations).toEqual(['F1', 'F2', 'F3', 'F4']);
  });
  it('accepts rounding to the precision written, in every notation', () => {
    for (const t of [
      'Revenue was $4.2B [F1].',
      'Revenue was $4.18 billion [F1].',
      'Revenue was 4,180 million dollars [F1].',
      'Revenue was $4,180,000,000 [F1].',
      'Growth was 12% [F2].',
      'Growth was 12.4 percent [F2].',
      'Insiders sold 1.25 million shares [F6].',
      'Insiders sold 1,250,000 shares [F6].',
      'Insiders sold 1.3M shares [F6].',
      'The close was $188.40 [F5].',
    ])
      expect(kinds(t), t).toEqual([]);
  });
  it('lets years, form names and item numbers from labels stand', () => {
    expect(kinds('The FY2026 report in the 10-K covers Q3 [F1].')).toEqual([]);
    expect(kinds('The company filed an 8-K with item 5.02 [F8].')).toEqual([]);
  });
  it('accepts a cited document for a claim with no figure', () => {
    expect(kinds('TestCo announced its results [D1].')).toEqual([]);
  });
});

describe('PHASE 2 FINISH CRITERION: a planted wrong number is rejected', () => {
  it('rejects a figure that matches no fact', () => {
    const v = verifyText('Revenue grew 14.1% year over year [F2].', payload);
    expect(v.ok).toBe(false);
    expect(v.issues[0]).toMatchObject({ kind: 'number-not-in-payload', token: '14.1%' });
  });
  it('rejects a figure just outside the precision it was written with', () => {
    expect(kinds('Revenue was $4.1B [F1].')).toEqual(['number-not-in-payload']);
    expect(kinds('Insiders sold 1.4M shares [F6].')).toEqual(['number-not-in-payload']);
    expect(kinds('Gross margin was 62% [F3].')).toEqual(['number-not-in-payload']);
  });
  it('rejects a real figure attached to the wrong source', () => {
    expect(kinds('Revenue was $4.2B [F2].')).toEqual(['number-not-cited']);
  });
  it('rejects a real figure with the wrong unit', () => {
    expect(kinds('Revenue grew 12.4 [F2].')).toEqual(['unit-mismatch']);
    expect(kinds('Gross margin was $61 [F3].')).toEqual(['unit-mismatch']);
    expect(kinds('The share price was 188.4% [F5].')).toEqual(['unit-mismatch']);
  });
  it('lists the mismatches in a form that can be fed back to the model', () => {
    const v = verifyText('Revenue grew 14.1% [F2].', payload);
    expect(describeIssues(v.issues)).toEqual([
      'number-not-in-payload: 14.1% matches no fact in the payload [14.1%]',
    ]);
  });
});

describe('direction', () => {
  it('rejects the wrong direction for a real figure', () => {
    expect(kinds('Operating margin rose 2.5% [F7].')).toEqual(['direction-mismatch']);
    expect(kinds('Revenue fell 12.4% [F2].')).toEqual(['direction-mismatch']);
  });
  it('accepts the right direction, and an explicit minus sign', () => {
    expect(kinds('Operating margin fell 2.5% [F7].')).toEqual([]);
    expect(kinds('Operating margin changed by -2.5% [F7].')).toEqual([]);
    expect(kinds('Revenue rose 12.4% [F2].')).toEqual([]);
  });
  it('KNOWN LIMIT: a sentence with both rising and falling words is not direction-checked', () => {
    expect(kinds('Revenue rose while margin fell 12.4% [F2].')).toEqual([]);
  });
});

describe('citations and style', () => {
  it('requires a citation in every sentence', () => {
    expect(kinds('Revenue was $4.18B [F1]. The outlook is mixed.')).toEqual(['uncited-sentence']);
  });
  it('rejects a citation that is not in the payload', () => {
    expect(kinds('Revenue was $4.18B [F99].')).toEqual([
      'unknown-citation',
      'uncited-sentence',
      'number-not-cited',
    ]);
  });
  it('accepts several ids in one marker and in separate markers', () => {
    expect(kinds('Revenue was $4.18B and grew 12.4% [F1, F2].')).toEqual([]);
    expect(kinds('Revenue was $4.18B and grew 12.4% [F1][F2].')).toEqual([]);
  });
  it('rejects derived comparisons that need arithmetic the payload does not carry', () => {
    expect(kinds('Revenue doubled [F1].')).toEqual(['derived-claim']);
  });
  it('rejects an em dash', () => {
    expect(kinds('Revenue was $4.18B [F1] — a record.')).toContain('em-dash');
  });
  it('rejects empty text', () => {
    expect(kinds('   ')).toEqual(['empty']);
  });
  it('KNOWN LIMIT: a figure spelled out as a word is not checked, so prompts forbid it', () => {
    expect(kinds('Revenue grew by roughly three percent [F2].')).toEqual([]);
  });
});

describe('figure extraction and sentence splitting', () => {
  it('reads the notations the prompts allow', () => {
    const t = extractNumbers('$4.2B, 12.4%, 28.4x, 1,250,000, 3.5 million, -2.5%, 188.40');
    expect(t.map((x) => [x.value, x.decimals, x.pct, x.usd, x.multiple])).toEqual([
      [4.2e9, 1, false, true, false],
      [12.4, 1, true, false, false],
      [28.4, 1, false, false, true],
      [1_250_000, 0, false, false, false],
      [3.5e6, 1, false, false, false],
      [-2.5, 1, true, false, false],
      [188.4, 2, false, false, false],
    ]);
  });
  it('ignores names that contain digits', () => {
    expect(
      extractNumbers('The 10-K, 8-K, 13F, Form 4, Q3, FY2026 and S&P 500 and 10b5-1 plan'),
    ).toEqual([]);
  });
  it('keeps decimals, U.S. and Inc. inside their sentence', () => {
    expect(
      splitSentences('TestCo Inc. earned $4.18B in the U.S. market [F1]. Margin was 61% [F3].'),
    ).toEqual(['TestCo Inc. earned $4.18B in the U.S. market [F1].', 'Margin was 61% [F3].']);
  });
});

describe('numbers that name a cited fact', () => {
  const p: Payload = {
    facts: [
      ...payload.facts,
      { id: 'F10', label: 'Days of cash on hand', value: 30.2, unit: 'count' },
    ],
    documents: [],
  };
  it('accepts "30 days" from the cited label even though another fact rounds to 30', () => {
    expect(verifyText('There were 7 filings in the last 30 days [F9].', p).issues).toEqual([]);
  });
  it('does not excuse the number without that citation, or a percent', () => {
    expect(kindsIn('There were 30 days of filings [F5].', p)).toEqual(['number-not-cited']);
    expect(verifyText('Filings rose 30% in the last 30 days [F9].', p).ok).toBe(false);
  });
});

function kindsIn(text: string, p: Payload) {
  return verifyText(text, p).issues.map((i) => i.kind);
}
