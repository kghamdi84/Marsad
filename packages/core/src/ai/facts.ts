/**
 * The payload a model call receives. Numbers come from data, never from the model: every figure in
 * generated text must match a fact below, and every sentence must cite what it relies on.
 */

export type FactUnit = 'usd' | 'pct' | 'count' | 'shares' | 'ratio' | 'date' | 'text';

export interface Fact {
  /** Citable id, for example `F3`. Facts use `F`, documents use `D`. */
  id: string;
  /** Plain description. Digits in a label (a year, a form or item number) may appear in text verbatim. */
  label: string;
  /**
   * Numeric facts hold the number in the unit named by `unit`: percent facts hold percentage points
   * (12.5 for 12.5%), `usd` facts hold dollars (not thousands), `ratio` facts hold multiples (28.4 for 28.4x).
   * Text and date facts hold a string and are not checked numerically.
   */
  value: number | string | null;
  unit: FactUnit;
  /** Where the value came from, shown with the citation. */
  source?: string;
  /** UTC ISO time the value is as of. */
  asOf?: string;
}

/** Untrusted text (a filing excerpt, a headline). Cited by id, never trusted as instructions. */
export interface DocumentExcerpt {
  id: string;
  title: string;
  text: string;
  source?: string;
  publishedAt?: string;
}

export interface Payload {
  facts: readonly Fact[];
  documents: readonly DocumentExcerpt[];
}

export function citableIds(payload: Payload): Set<string> {
  return new Set([...payload.facts.map((f) => f.id), ...payload.documents.map((d) => d.id)]);
}
