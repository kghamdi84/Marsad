import { describe, expect, it } from 'vitest';
import fixture from '../../../fixtures/massive/sections-NVDA-risk_factors.json';
import {
  CHANGED_SENTENCE_DICE,
  type DatedSection,
  RISK_DIFF_VERSION,
  cleanSectionLines,
  diceOnWordPairs,
  diffRiskFactors,
  latestYearOverYear,
  sectionSentences,
  splitRiskSentences,
  wordDiff,
} from './riskfactors.js';

// Counts and Dice values below were worked out by hand, or by an independent Python implementation written from the
// rules (not from this code), which agreed with this module on every added, removed and changed sentence of the real
// NVIDIA pair (matching hashes of all three lists).

describe('cleaning the text of a section', () => {
  // Real text from the NVIDIA 10-K for fiscal 2025 (recorded 2026-11-24): a page break cuts a sentence in two.
  const raw = [
    'Item 1A. Risk Factors',
    'The following risk factors should be considered in addition to the other information in this Annual Report on Form 10-K. The following risks could harm our business, financial condition, results of operations or reputation, which could cause our stock',
    '13',
    'Table of Contents',
    'price to decline. Additional risks may also harm our business.',
    'Risk Factors Summary',
    'Risks Related to Our Industry and Markets',
    '- Competition could adversely impact our market share and financial results.',
  ].join('\n');
  const lines = cleanSectionLines(raw);

  it('drops page numbers and "Table of Contents" lines and rejoins the sentence the page cut', () => {
    expect(lines.map((l) => l.text)).toEqual([
      'Item 1A. Risk Factors',
      'The following risk factors should be considered in addition to the other information in this Annual Report on Form 10-K. The following risks could harm our business, financial condition, results of operations or reputation, which could cause our stock price to decline. Additional risks may also harm our business.',
      'Risk Factors Summary',
      'Risks Related to Our Industry and Markets',
      '- Competition could adversely impact our market share and financial results.',
    ]);
  });
  it('remembers the nearest heading above each line', () => {
    expect(lines.map((l) => l.context)).toEqual([
      'Item 1A. Risk Factors',
      'Item 1A. Risk Factors',
      'Risk Factors Summary',
      'Risks Related to Our Industry and Markets',
      'Risks Related to Our Industry and Markets', // a bullet is not a heading
    ]);
  });
  it('does not take a bullet with no closing punctuation for a heading', () => {
    // Real bullets of the section run on to "; and" or end mid-list, so the full stop test alone would not stop them.
    const l = cleanSectionLines(
      [
        'Risks Related to Demand, Supply, and Manufacturing',
        "- our customers' ability to build datacenters",
      ].join('\n'),
    );
    expect(l.map((x) => x.context)).toEqual([
      'Risks Related to Demand, Supply, and Manufacturing',
      'Risks Related to Demand, Supply, and Manufacturing',
    ]);
  });
  it('does not glue a line that ends a sentence to a lowercase line, or a short heading to anything', () => {
    const l = cleanSectionLines(
      [
        'We may lose sales in China if export rules tighten, and that could hurt results.',
        'including our data center business.',
        'Supply',
        'and demand',
      ].join('\n'),
    );
    expect(l.map((x) => x.text)).toEqual([
      'We may lose sales in China if export rules tighten, and that could hurt results.',
      'including our data center business.',
      'Supply',
      'and demand',
    ]);
  });
  it('treats non-breaking spaces and runs of spaces as one space', () => {
    expect(cleanSectionLines('Net revenue   rose.').map((l) => l.text)).toEqual([
      'Net revenue rose.',
    ]);
  });
});

describe('sentences', () => {
  it('splits after a full stop followed by a capital or digit, not inside "U.S. and"', () => {
    expect(
      splitRiskSentences('We sell in the U.S. and abroad. In 2025 we grew. "Quoted" next.'),
    ).toEqual(['We sell in the U.S. and abroad.', 'In 2025 we grew.', '"Quoted" next.']);
  });
  it('drops the bullet mark and any line with no words in it', () => {
    expect(
      sectionSentences('- Prices may fall.\n-\n*\nCosts may rise.').map((s) => s.text),
    ).toEqual(['Prices may fall.', 'Costs may rise.']);
  });
});

describe('Dice on word pairs', () => {
  it('is 1 for the same words, ignoring case and punctuation, and 0 for no shared pair', () => {
    expect(diceOnWordPairs('Prices may fall.', 'prices, MAY fall')).toBe(1);
    expect(diceOnWordPairs('prices may fall', 'costs will rise')).toBe(0);
  });
  it('is 2 x shared / (pairs in a + pairs in b): "the quick brown fox" against "the quick red fox" is 2 x 1 / 6', () => {
    // pairs a: the quick, quick brown, brown fox; pairs b: the quick, quick red, red fox; shared: the quick
    expect(diceOnWordPairs('the quick brown fox', 'the quick red fox')).toBeCloseTo(1 / 3, 12);
  });
  it('one word swapped in a 29-word sentence: 28 pairs each, 26 shared, 2 x 26 / 56', () => {
    const a =
      'Long manufacturing lead times and uncertain supply and component availability, combined with a failure to estimate customer demand accurately, has led and could lead to mismatches between supply and demand.';
    const b = a.replace('component', 'capacity');
    expect(diceOnWordPairs(a, b)).toBeCloseTo(26 / 28, 12);
    expect(26 / 28).toBeCloseTo(0.9285714285714286, 12);
  });
  it('is 0 when a sentence has fewer than two words', () => {
    expect(diceOnWordPairs('Hello', 'Hello')).toBe(0);
  });
});

describe('word-by-word view of an edited sentence', () => {
  it('shows an insertion', () => {
    expect(
      wordDiff('We may lose sales in China.', 'We may lose some sales in China and Taiwan.'),
    ).toEqual([
      { op: 'same', text: 'We may lose' },
      { op: 'added', text: 'some' },
      { op: 'same', text: 'sales in China' }, // the full stop on "China." counts as part of the word
      { op: 'added', text: 'and Taiwan.' },
    ]);
  });
  it('shows a swapped word as a removal then an addition and keeps the new spelling', () => {
    expect(
      wordDiff(
        'uncertain supply and component availability',
        'uncertain supply and capacity availability',
      ),
    ).toEqual([
      { op: 'same', text: 'uncertain supply and' },
      { op: 'removed', text: 'component' },
      { op: 'added', text: 'capacity' },
      { op: 'same', text: 'availability' },
    ]);
  });
  it('identical sentences give one unchanged segment', () => {
    expect(wordDiff('Prices may fall.', 'prices may fall.')).toEqual([
      { op: 'same', text: 'prices may fall.' },
    ]);
  });
});

describe('comparing two years of text', () => {
  const older = [
    'Risks Related to Supply',
    'We depend on a few suppliers for our wafers.',
    'We may lose sales in China if export rules tighten.',
    'Prices may fall.',
    'A customer may delay orders and we may carry excess inventory.',
  ].join('\n');
  const newer = [
    'Risks Related to Supply',
    'We depend on a few suppliers for our wafers.',
    'We may lose sales in China and Taiwan if export rules tighten.',
    'Prices may fall.',
    'We entered a license agreement with a new partner and paid a large fee.',
  ].join('\n');
  const d = diffRiskFactors(older, newer);

  it('counts what stayed, what is new, what is gone and what was edited', () => {
    expect(d).toMatchObject({
      formulaVersion: RISK_DIFF_VERSION,
      oldSentences: 5,
      newSentences: 5,
      unchanged: 3, // the heading, the wafers sentence and "Prices may fall."
    });
    expect(d.added.map((s) => s.text)).toEqual([
      'We entered a license agreement with a new partner and paid a large fee.',
    ]);
    expect(d.removed.map((s) => s.text)).toEqual([
      'A customer may delay orders and we may carry excess inventory.',
    ]);
  });
  it('pairs the edited China sentence: 9 pairs before, 11 after, 8 shared, so 2 x 8 / 20 = 0.8', () => {
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0]?.similarity).toBeCloseTo(0.8, 12);
    expect(d.changed[0]?.words.filter((w) => w.op !== 'same')).toEqual([
      { op: 'added', text: 'and Taiwan' },
    ]);
  });
  it('gives each sentence the heading it sat under', () => {
    expect(d.added[0]?.context).toBe('Risks Related to Supply');
  });
  it('the same text twice has nothing added, removed or changed', () => {
    const same = diffRiskFactors(older, older);
    expect([same.added, same.removed, same.changed].map((x) => x.length)).toEqual([0, 0, 0]);
    expect(same.unchanged).toBe(5);
  });
  it('a sentence cut by a page break in one year and whole in the other is still unchanged', () => {
    const whole = 'We depend on a few suppliers for our wafers and test houses.';
    const cut =
      'We depend on a few suppliers for our wafers and\n14\nTable of Contents\ntest houses.';
    const r = diffRiskFactors(whole, cut);
    expect([r.unchanged, r.added.length, r.removed.length, r.changed.length]).toEqual([1, 0, 0, 0]);
  });
  it('a sentence twice in one year and once in the other leaves one removed', () => {
    const r = diffRiskFactors(
      'Prices may fall again soon.\nPrices may fall again soon.',
      'Prices may fall again soon.',
    );
    expect([r.unchanged, r.removed.length]).toEqual([1, 1]);
  });
});

describe('the edit threshold', () => {
  // a: alpha beta gamma delta epsilon zeta (5 pairs); b shares 3 pairs, so 2 x 3 / 10 = 0.6 exactly
  const a = 'alpha beta gamma delta epsilon zeta.';
  it('counts exactly 0.6 as an edit', () => {
    expect(CHANGED_SENTENCE_DICE).toBe(0.6);
    const r = diffRiskFactors(a, 'alpha beta gamma delta kappa lambda.');
    expect(r.changed).toHaveLength(1);
    expect(r.changed[0]?.similarity).toBe(0.6);
  });
  it('treats 0.4 (2 shared pairs of 5 and 5) as a different sentence', () => {
    const r = diffRiskFactors(a, 'alpha beta gamma kappa lambda mu.');
    expect([r.changed.length, r.added.length, r.removed.length]).toEqual([0, 1, 1]);
  });
  it('never fuzzy-matches a sentence of fewer than five words, even at a high score', () => {
    // "red green blue pink" against "red green blue gold": 3 pairs each, 2 shared = 0.667, but only 4 words.
    const r = diffRiskFactors('red green blue pink.', 'red green blue gold.');
    expect([r.changed.length, r.added.length, r.removed.length]).toEqual([0, 1, 1]);
  });
  it('pairs each sentence once, the best pair first', () => {
    const r = diffRiskFactors(
      'one two three four five six seven.\none two three four five six eight nine.',
      'one two three four five six seven eight.',
    );
    // new sentence has 7 pairs; old A shares 6 of 6 (Dice 12/13); old B shares 5 of 7 (Dice 10/14): A wins.
    expect(r.changed).toHaveLength(1);
    expect(r.changed[0]?.before.text).toBe('one two three four five six seven.');
    expect(r.removed.map((s) => s.text)).toEqual(['one two three four five six eight nine.']);
  });
});

describe('choosing the two years', () => {
  const s = (periodEnd: string) => ({ periodEnd, filingDate: periodEnd, text: '', filingUrl: 'u' });
  it('takes the newest and the report a fiscal year before it, whatever the order', () => {
    const r = latestYearOverYear([s('2025-01-26'), s('2026-01-25'), s('2017-01-29')]);
    expect(r).toMatchObject({
      ok: true,
      newer: { periodEnd: '2026-01-25' },
      older: { periodEnd: '2025-01-26' },
    });
  });
  it('refuses a pair that is not a year apart (the real vendor history jumped from 2025 to 2017)', () => {
    expect(latestYearOverYear([s('2025-01-26'), s('2017-01-29')])).toEqual({
      ok: false,
      reason: 'gap',
    });
  });
  it('allows 350 and 380 days, not 349 or 381', () => {
    // 2026-01-25 minus 350 days is 2025-02-09; minus 349 is 2025-02-10; minus 380 is 2025-01-10; minus 381 is 2025-01-09.
    expect(latestYearOverYear([s('2026-01-25'), s('2025-02-09')]).ok).toBe(true);
    expect(latestYearOverYear([s('2026-01-25'), s('2025-02-10')]).ok).toBe(false);
    expect(latestYearOverYear([s('2026-01-25'), s('2025-01-10')]).ok).toBe(true);
    expect(latestYearOverYear([s('2026-01-25'), s('2025-01-09')]).ok).toBe(false);
  });
  it('says so when there is one report or none', () => {
    expect(latestYearOverYear([s('2026-01-25')])).toEqual({ ok: false, reason: 'one-report' });
    expect(latestYearOverYear([])).toEqual({ ok: false, reason: 'none' });
  });
});

describe('the real NVIDIA 10-Ks for fiscal 2025 and 2026 (recorded 2026-11-24)', () => {
  const [newer, older] = fixture.body.results.map((r) => ({
    periodEnd: r.period_end,
    filingDate: r.filing_date,
    text: r.text,
    filingUrl: r.filing_url,
  })) as [DatedSection, DatedSection];
  const d = diffRiskFactors(older.text, newer.text);

  it('reads two filings a fiscal year apart', () => {
    expect([older.periodEnd, newer.periodEnd]).toEqual(['2025-01-26', '2026-01-25']);
    expect(latestYearOverYear([newer, older])).toMatchObject({ ok: true });
  });
  it('counts match an independent Python implementation', () => {
    expect({
      old: d.oldSentences,
      new: d.newSentences,
      unchanged: d.unchanged,
      added: d.added.length,
      removed: d.removed.length,
      changed: d.changed.length,
    }).toEqual({ old: 564, new: 586, unchanged: 449, added: 71, removed: 49, changed: 66 });
    // every sentence of each year is accounted for exactly once
    expect(d.unchanged + d.removed.length + d.changed.length).toBe(d.oldSentences);
    expect(d.unchanged + d.added.length + d.changed.length).toBe(d.newSentences);
  });
  it('finds the new Groq licence risk and the dropped DGX Cloud risk', () => {
    expect(d.added.map((s) => s.text)).toContain(
      'We have entered into an intellectual property license arrangement with Groq, Inc., or Groq, that required significant, nonrefundable payments.',
    );
    expect(d.removed.map((s) => s.text)).toContain(
      'NVIDIA DGX Cloud services may not be successful and will take time, resources, and investment.',
    );
  });
  it('shows the one-word edit "component" to "capacity" with Dice 26/28', () => {
    const c = d.changed.find((x) =>
      x.before.text.includes('uncertain supply and component availability, combined'),
    );
    expect(c?.similarity).toBeCloseTo(0.9285714285714286, 12);
    expect(c?.words.filter((w) => w.op !== 'same')).toEqual([
      { op: 'removed', text: 'component' },
      { op: 'added', text: 'capacity' },
    ]);
  });
  it('has no page numbers or "Table of Contents" left inside any sentence', () => {
    const all = [...d.added, ...d.removed, ...d.changed.map((c) => c.after)].map((s) => s.text);
    expect(all.some((t) => /table of contents/i.test(t))).toBe(false);
  });
});
