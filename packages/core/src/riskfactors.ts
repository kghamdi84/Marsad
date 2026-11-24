/**
 * Year-over-year comparison of the Risk Factors section of two annual reports (10-K), by code and without a model.
 *
 * It works on sentences, not paragraphs: the plain text breaks pages mid-paragraph and in different places each
 * year, so a paragraph that did not change can still be cut differently. A sentence is the same sentence after
 * a page break. A sentence counts as unchanged when its words match exactly (ignoring case and punctuation),
 * as changed when it pairs with a sentence in the other year with enough shared word pairs, and otherwise as
 * added or removed. The 0.6 cut-off is a Marsad default chosen on real pairs (docs/DATA_SOURCES.md), not a
 * standard. The result says what the wording does, not whether a risk got worse.
 */

/** Version of the rules behind a comparison, shown with it (integrity rule 1). */
export const RISK_DIFF_VERSION = 'riskdiff-1';

/** Two sentences are "the same sentence, edited" at or above this Dice score on word pairs. */
export const CHANGED_SENTENCE_DICE = 0.6;

/** A sentence with fewer words than this is only ever matched exactly (short lines match too easily). */
export const MIN_WORDS_FOR_FUZZY = 5;

const PAGE_NUMBER = /^\d{1,3}$/;
const CONTENTS_LINE = /^table of contents$/i;
const ENDS_A_SENTENCE = /[.!?:;)"'’”]$/;
const STARTS_LOWERCASE = /^[a-z]/;
/** A heading is a short line that is not a sentence: "Risks Related to Our Industry and Markets". */
const MAX_HEADING_CHARS = 160;
/** A line this short is never glued to the next one: it is a heading or a label, not a cut sentence. */
const MIN_CUT_LINE_CHARS = 40;

export interface Sentence {
  text: string;
  /** The nearest heading above it, when there is one. */
  context: string | null;
}

/** One cleaned line of the section: its text and the heading it sits under. */
interface Line {
  text: string;
  context: string | null;
}

/**
 * Lines of the section with page furniture removed (page numbers, "Table of Contents") and sentences that a page
 * break cut in two put back together. A line is glued to the next one only when it does not end a sentence and the
 * next starts in lowercase, which is certain evidence of a cut. Headings are remembered for context.
 */
export function cleanSectionLines(raw: string): Line[] {
  const kept = raw
    .replace(/\r/g, '')
    .split('\n')
    .map((l) =>
      l
        .replace(/\u200b/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((l) => l !== '' && !PAGE_NUMBER.test(l) && !CONTENTS_LINE.test(l));
  const joined: string[] = [];
  for (const line of kept) {
    const prev = joined.at(-1);
    if (
      prev !== undefined &&
      prev.length >= MIN_CUT_LINE_CHARS &&
      !ENDS_A_SENTENCE.test(prev) &&
      STARTS_LOWERCASE.test(line)
    )
      joined[joined.length - 1] = `${prev} ${line}`;
    else joined.push(line);
  }
  let context: string | null = null;
  return joined.map((text) => {
    if (text.length <= MAX_HEADING_CHARS && !ENDS_A_SENTENCE.test(text) && !/^[-•]/.test(text))
      context = text;
    return { text, context };
  });
}

/** Splits a line into sentences at ". ", "? " or "! " followed by a capital, a digit, a quote or a bracket. */
export function splitRiskSentences(line: string): string[] {
  return line
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/** The sentences of a section in reading order, each with its heading. */
export function sectionSentences(raw: string): Sentence[] {
  return cleanSectionLines(raw).flatMap((l) =>
    splitRiskSentences(l.text)
      .filter((text) => words(text).length > 0) // a stray "-" or "*" is not a sentence
      .map((text) => ({ text: text.replace(/^[-\u2022]\s+/, ''), context: l.context })),
  );
}

const words = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

function pairs(tokens: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 1 < tokens.length; i++) out.add(`${tokens[i]} ${tokens[i + 1]}`);
  return out;
}

/** Dice coefficient on the sets of word pairs: 2 x shared / (pairs in a + pairs in b). 1 is identical, 0 is nothing shared. */
export function diceOnWordPairs(a: string, b: string): number {
  const pa = pairs(words(a));
  const pb = pairs(words(b));
  if (pa.size + pb.size === 0) return 0;
  let shared = 0;
  for (const p of pa) if (pb.has(p)) shared++;
  return (2 * shared) / (pa.size + pb.size);
}

export interface WordSegment {
  text: string;
  op: 'same' | 'added' | 'removed';
}

/** Word-by-word comparison of an edited sentence (longest common run of words), with the original spelling kept. */
export function wordDiff(before: string, after: string): WordSegment[] {
  const a = before.split(/\s+/).filter(Boolean);
  const b = after.split(/\s+/).filter(Boolean);
  const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  const at = (i: number, j: number): number => lcs[i]?.[j] ?? 0;
  const same = (i: number, j: number): boolean => norm(a[i] ?? '') === norm(b[j] ?? '');
  for (let i = n - 1; i >= 0; i--) {
    const row = lcs[i];
    if (!row) continue;
    for (let j = m - 1; j >= 0; j--)
      row[j] = same(i, j) ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
  }
  const raw: WordSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (same(i, j)) {
      raw.push({ text: b[j] ?? '', op: 'same' });
      i++;
      j++;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      raw.push({ text: a[i++] ?? '', op: 'removed' });
    } else {
      raw.push({ text: b[j++] ?? '', op: 'added' });
    }
  }
  while (i < n) raw.push({ text: a[i++] ?? '', op: 'removed' });
  while (j < m) raw.push({ text: b[j++] ?? '', op: 'added' });
  const out: WordSegment[] = [];
  for (const s of raw) {
    const last = out.at(-1);
    if (last && last.op === s.op) last.text += ` ${s.text}`;
    else out.push({ ...s });
  }
  return out;
}

export interface ChangedSentence {
  before: Sentence;
  after: Sentence;
  /** Dice score on word pairs, 0.6 to just under 1. */
  similarity: number;
  words: WordSegment[];
}

export interface RiskDiff {
  formulaVersion: string;
  /** Sentences in the older and newer section. */
  oldSentences: number;
  newSentences: number;
  /** Sentences whose words match exactly (ignoring case and punctuation). */
  unchanged: number;
  /** Only in the newer report. */
  added: Sentence[];
  /** Only in the older report. */
  removed: Sentence[];
  /** The same sentence edited. */
  changed: ChangedSentence[];
}

/** Compares the Risk Factors text of an older and a newer 10-K. */
export function diffRiskFactors(olderText: string, newerText: string): RiskDiff {
  const older = sectionSentences(olderText);
  const newer = sectionSentences(newerText);
  const key = (s: Sentence) => words(s.text).join(' ');

  // Exact matches first, one to one: a sentence that appears twice in one year and once in the other leaves one over.
  const oldByKey = new Map<string, number[]>();
  older.forEach((s, i) => {
    const k = key(s);
    if (k !== '') oldByKey.set(k, [...(oldByKey.get(k) ?? []), i]);
  });
  const oldUsed = new Set<number>();
  const newUsed = new Set<number>();
  let unchanged = 0;
  newer.forEach((s, j) => {
    const slot = oldByKey.get(key(s));
    const i = slot?.shift();
    if (i !== undefined) {
      oldUsed.add(i);
      newUsed.add(j);
      unchanged++;
    }
  });

  // Edited sentences: best pairs first, each sentence used once.
  const leftOld = older.flatMap((s, i) =>
    !oldUsed.has(i) && words(s.text).length >= MIN_WORDS_FOR_FUZZY ? [i] : [],
  );
  const leftNew = newer.flatMap((s, j) =>
    !newUsed.has(j) && words(s.text).length >= MIN_WORDS_FOR_FUZZY ? [j] : [],
  );
  const candidates: { i: number; j: number; sim: number }[] = [];
  for (const j of leftNew)
    for (const i of leftOld) {
      const sim = diceOnWordPairs((older[i] as Sentence).text, (newer[j] as Sentence).text);
      if (sim >= CHANGED_SENTENCE_DICE) candidates.push({ i, j, sim });
    }
  candidates.sort((x, y) => y.sim - x.sim || x.j - y.j || x.i - y.i);
  const pairedNew = new Map<number, { i: number; sim: number }>();
  for (const c of candidates) {
    if (oldUsed.has(c.i) || newUsed.has(c.j)) continue;
    oldUsed.add(c.i);
    newUsed.add(c.j);
    pairedNew.set(c.j, { i: c.i, sim: c.sim });
  }

  const changed: ChangedSentence[] = [...pairedNew.entries()]
    .sort(([a], [b]) => a - b)
    .map(([j, { i, sim }]) => {
      const before = older[i] as Sentence;
      const after = newer[j] as Sentence;
      return { before, after, similarity: sim, words: wordDiff(before.text, after.text) };
    });

  return {
    formulaVersion: RISK_DIFF_VERSION,
    oldSentences: older.length,
    newSentences: newer.length,
    unchanged,
    added: newer.filter((_, j) => !newUsed.has(j)),
    removed: older.filter((_, i) => !oldUsed.has(i)),
    changed,
  };
}

/** A fiscal year is 52 or 53 weeks, so two year ends are "a year apart" within this many days of 365. */
const YEAR_GAP_MIN_DAYS = 350;
const YEAR_GAP_MAX_DAYS = 380;

export interface DatedSection {
  periodEnd: string;
  filingDate: string;
  text: string;
  filingUrl: string;
}

export type YearPair<T extends DatedSection> =
  { ok: true; newer: T; older: T } | { ok: false; reason: 'none' | 'one-report' | 'gap' };

/**
 * The newest report and the one for the year before it. The vendor's history has holes (NVIDIA returned 2026, 2025
 * and then 2017), so the two period ends must be a fiscal year apart; otherwise there is nothing fair to compare.
 */
export function latestYearOverYear<T extends DatedSection>(sections: readonly T[]): YearPair<T> {
  const sorted = [...sections].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
  const [newer, older] = sorted;
  if (!newer) return { ok: false, reason: 'none' };
  if (!older) return { ok: false, reason: 'one-report' };
  const days =
    (Date.parse(`${newer.periodEnd}T00:00:00Z`) - Date.parse(`${older.periodEnd}T00:00:00Z`)) /
    86_400_000;
  if (days < YEAR_GAP_MIN_DAYS || days > YEAR_GAP_MAX_DAYS) return { ok: false, reason: 'gap' };
  return { ok: true, newer, older };
}
