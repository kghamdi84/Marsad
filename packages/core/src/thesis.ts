/**
 * The thesis card (ADR 0025, `thesis-1`): bull case, bear case (required), key risks, what would change the view,
 * sources and a status. Every idea has its other side written down before it is held; confirmation bias is the
 * most expensive habit a trader has. Khaled writes the card; an AI draft from cited sources can fill the same
 * fields once an Anthropic key and cost caps are set. Pure.
 */
import type { ThesisStatus } from './rotation.js';

export const THESIS_VERSION = 'thesis-1';

export interface ThesisDraft {
  ticker: string;
  status: ThesisStatus;
  bull: string;
  bear: string;
  risks: string[];
  changeView: string;
  /** https links to filings, articles or data the card relies on. */
  sources: string[];
}

/** Shortest bear case and "what would change my view" accepted: one real sentence, not a placeholder. */
export const MIN_SIDE_CHARS = 40;

/** Problems with a draft, in plain words; empty when it can be saved. */
export function validateThesis(d: ThesisDraft): string[] {
  const out: string[] = [];
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(d.ticker)) out.push('The ticker is not valid.');
  if (d.bull.trim().length === 0) out.push('Write the bull case.');
  if (d.bear.trim().length < MIN_SIDE_CHARS)
    out.push(`The bear case is required: at least ${MIN_SIDE_CHARS} characters, a real argument.`);
  if (d.risks.filter((r) => r.trim() !== '').length === 0) out.push('Name at least one key risk.');
  if (d.changeView.trim().length < MIN_SIDE_CHARS)
    out.push(
      `Say what would change your view: at least ${MIN_SIDE_CHARS} characters, something you could observe.`,
    );
  const bad = d.sources.filter((s) => !/^https:\/\/[^\s]+$/.test(s));
  if (bad.length > 0) out.push(`Sources must be https links: ${bad.join(', ')}.`);
  if (d.bull.length > 4000 || d.bear.length > 4000 || d.changeView.length > 2000)
    out.push('Keep each part under 4,000 characters.');
  if (d.risks.length > 10 || d.sources.length > 10) out.push('At most 10 risks and 10 sources.');
  return out;
}

/** Splits a multi-line text box into trimmed, non-empty lines (for risks and sources). */
export function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}
