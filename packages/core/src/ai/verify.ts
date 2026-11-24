/**
 * The number verifier (integrity rules 17 and 19). Claude explains; code decides and calculates, so every
 * figure in generated text must match a fact in the payload it was given, and every sentence must cite the
 * facts or documents it rests on. Anything that does not match is reported, never silently accepted.
 *
 * What it checks, per sentence:
 * 1. at least one citation, and every citation names a payload id (`[F1]`, `[F1, D2]`);
 * 2. every figure matches a numeric fact within the precision it was written with (4.2B matches 4.18e9);
 * 3. that fact is one of the facts cited in the same sentence, so a true number cannot sit under a wrong source;
 * 4. percent figures match only percent facts, dollar figures only dollar facts, multiples only ratio facts;
 * 5. a stated direction (rose, fell, a minus sign) agrees with the sign of the fact;
 * 6. no em dash, and no derived-comparison words (doubled, halved) that need arithmetic the payload lacks.
 *
 * What it cannot catch, stated plainly: numbers spelled as words ("three"), a figure that coincides with a
 * different cited fact of the same unit and value, and a sentence that mixes rising and falling words (the
 * direction is then not checked). Prompts forbid spelled-out figures, and the cost of a miss is bounded by the
 * fact that the citation shows where each figure came from.
 */
import { citableIds, type Fact, type Payload } from './facts.js';
import { extractNumbers, stripNonFigures, type NumberToken } from './numbers.js';

export type IssueKind =
  | 'empty'
  | 'uncited-sentence'
  | 'unknown-citation'
  | 'number-not-in-payload'
  | 'number-not-cited'
  | 'unit-mismatch'
  | 'direction-mismatch'
  | 'derived-claim'
  | 'em-dash';

export interface Issue {
  kind: IssueKind;
  sentence: string;
  /** The offending figure or citation, when there is one. */
  token?: string;
  detail: string;
}

export interface Verification {
  ok: boolean;
  issues: Issue[];
  /** Citation ids used anywhere in the text, in order of first use. */
  citations: string[];
  numbersChecked: number;
}

const CITATION = /\[([A-Z]\d+(?:\s*,\s*[A-Z]\d+)*)\]/g;
const UP =
  /\b(?:rose|rises?|rising|up|increased?|increases|grew|grow|grows|growth|gain(?:ed|s)?|higher|climbed|jumped|surged|expanded|accelerated)\b/i;
const DOWN =
  /\b(?:fell|falls?|falling|down|decreased?|decreases|declined?|declines|drop(?:ped|s)?|lower|loss(?:es)?|slid|slumped|shrank|contracted|decelerated|below)\b/i;
const DERIVED = /\b(?:doubled|tripled|quadrupled|halved|twice|thrice)\b/i;
const ABBREVIATIONS: readonly [RegExp, string][] = [
  [/\bU\.S\./g, 'U_S_'],
  [/\bInc\./g, 'Inc_'],
  [/\bCorp\./g, 'Corp_'],
  [/\bCo\./g, 'Co_'],
  [/\bLtd\./g, 'Ltd_'],
  [/\bvs\./gi, 'vs_'],
  [/\be\.g\./gi, 'e_g_'],
  [/\bi\.e\./gi, 'i_e_'],
  [/\bNo\.\s?(?=\d)/g, 'No_ '],
];

/** Splits text into sentences, keeping decimals, initials and common abbreviations whole. */
export function splitSentences(text: string): string[] {
  let t = text.replace(/\r/g, '').replace(/\n+/g, '\n');
  for (const [re, to] of ABBREVIATIONS) t = t.replace(re, to);
  return t
    .split(/(?<=[.!?])(?:\s+|(?=\[))|\n/)
    .map((s) => s.trim())
    .filter((s) => /[A-Za-z0-9]/.test(s))
    .map((s) =>
      s
        .replace(/U_S_/g, 'U.S.')
        .replace(/(Inc|Corp|Co|Ltd|vs|No)_/g, '$1.')
        .replace(/e_g_/g, 'e.g.')
        .replace(/i_e_/g, 'i.e.'),
    );
}

/** Every digit string in labels and string values of facts: years, form and item numbers may appear verbatim. */
function labelNumerals(facts: readonly Fact[]): Set<string> {
  const out = new Set<string>();
  for (const f of facts) {
    const sources = [f.label, typeof f.value === 'string' ? f.value : ''];
    for (const s of sources) for (const m of s.matchAll(/\d+(?:\.\d+)?/g)) out.add(m[0]);
  }
  return out;
}

function unitAllows(token: NumberToken, fact: Fact): boolean {
  if (typeof fact.value !== 'number') return false;
  if (token.pct) return fact.unit === 'pct';
  if (token.multiple) return fact.unit === 'ratio';
  if (token.usd) return fact.unit === 'usd';
  if (token.magnitude > 1)
    return fact.unit === 'usd' || fact.unit === 'shares' || fact.unit === 'count';
  return (
    fact.unit === 'count' || fact.unit === 'shares' || fact.unit === 'usd' || fact.unit === 'ratio'
  );
}

/** True when the figure equals the fact rounded to the precision the text was written with. */
function valueMatches(token: NumberToken, fact: Fact): boolean {
  if (typeof fact.value !== 'number') return false;
  const tolerance = 0.5 * 10 ** -token.decimals * token.magnitude;
  return Math.abs(Math.abs(fact.value) - Math.abs(token.value)) <= tolerance * (1 + 1e-9) + 1e-12;
}

function claimedDirection(sentence: string, token: NumberToken): 'up' | 'down' | null {
  if (token.negative) return 'down';
  const up = UP.test(sentence);
  const down = DOWN.test(sentence);
  if (up && !down) return 'up';
  if (down && !up) return 'down';
  return null;
}

export interface VerifyOptions {
  /** Require a citation in every sentence. Default true. */
  requireCitations?: boolean;
}

export function verifyText(
  text: string,
  payload: Payload,
  options: VerifyOptions = {},
): Verification {
  const issues: Issue[] = [];
  const ids = citableIds(payload);
  const numerals = labelNumerals(payload.facts);
  const used: string[] = [];
  let numbersChecked = 0;

  if (text.trim() === '') {
    return {
      ok: false,
      issues: [{ kind: 'empty', sentence: '', detail: 'The text is empty' }],
      citations: [],
      numbersChecked: 0,
    };
  }
  if (text.includes('—'))
    issues.push({
      kind: 'em-dash',
      sentence: text.slice(0, 80),
      detail: 'The text contains an em dash',
    });

  for (const sentence of splitSentences(text)) {
    const cited: string[] = [];
    for (const m of sentence.matchAll(CITATION)) {
      for (const id of (m[1] ?? '').split(',').map((s) => s.trim())) {
        if (!ids.has(id)) {
          issues.push({
            kind: 'unknown-citation',
            sentence,
            token: id,
            detail: `Citation ${id} is not in the payload`,
          });
        } else {
          cited.push(id);
          if (!used.includes(id)) used.push(id);
        }
      }
    }
    if ((options.requireCitations ?? true) && cited.length === 0) {
      issues.push({ kind: 'uncited-sentence', sentence, detail: 'The sentence cites no source' });
    }
    if (DERIVED.test(sentence)) {
      issues.push({
        kind: 'derived-claim',
        sentence,
        token: DERIVED.exec(sentence)?.[0] ?? '',
        detail: 'A derived comparison must come from a fact, not from the model',
      });
    }
    const bare = sentence.replace(CITATION, ' ');
    for (const token of extractNumbers(stripNonFigures(bare))) {
      numbersChecked += 1;
      const rawDigits = token.digits;
      const candidates = payload.facts.filter(
        (f) => valueMatches(token, f) && unitAllows(token, f),
      );
      if (candidates.length === 0) {
        const wrongUnit = payload.facts.find((f) => valueMatches(token, f));
        if (
          !wrongUnit &&
          numerals.has(rawDigits) &&
          !token.pct &&
          !token.usd &&
          token.magnitude === 1
        )
          continue; // a year, form number or item number written in a label
        issues.push({
          kind: wrongUnit ? 'unit-mismatch' : 'number-not-in-payload',
          sentence,
          token: token.raw,
          detail: wrongUnit
            ? `${token.raw} equals ${wrongUnit.id} (${wrongUnit.label}) but its unit differs`
            : `${token.raw} matches no fact in the payload`,
        });
        continue;
      }
      const citedMatch = candidates.filter((f) => cited.includes(f.id));
      if (citedMatch.length === 0) {
        issues.push({
          kind: 'number-not-cited',
          sentence,
          token: token.raw,
          detail: `${token.raw} matches ${candidates.map((f) => f.id).join(', ')} but the sentence does not cite it`,
        });
        continue;
      }
      const dir = claimedDirection(bare, token);
      if (dir) {
        const signs = new Set(
          citedMatch.map((f) => Math.sign(f.value as number)).filter((s) => s !== 0),
        );
        const wanted = dir === 'up' ? 1 : -1;
        if (signs.size > 0 && !signs.has(wanted)) {
          issues.push({
            kind: 'direction-mismatch',
            sentence,
            token: token.raw,
            detail: `The text says ${dir} but ${citedMatch.map((f) => f.id).join(', ')} is ${wanted === 1 ? 'negative' : 'positive'}`,
          });
        }
      }
    }
  }
  return { ok: issues.length === 0, issues, citations: used, numbersChecked };
}

/** A short list of mismatches for the retry prompt, or for a log line. */
export function describeIssues(issues: readonly Issue[], limit = 8): string[] {
  return issues
    .slice(0, limit)
    .map((i) => `${i.kind}: ${i.detail}${i.token ? ` [${i.token}]` : ''}`);
}
