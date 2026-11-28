/**
 * The structured output every grounded prompt asks for (`output_config.format`), and reading it back. The model
 * writes its prose, citations included, in one `text` field, so the prompt text and its evaluation cases stay the
 * same and the JSON schema only guarantees the reply can be parsed. Pure.
 */

/** JSON schema for a grounded answer: one string, nothing else. */
export const GROUNDED_TEXT_SCHEMA: Readonly<Record<string, unknown>> = Object.freeze({
  type: 'object',
  properties: { text: { type: 'string' } },
  required: ['text'],
  additionalProperties: false,
});

/** The `text` of a grounded answer, or null when the reply is not that JSON object. */
export function parseGroundedText(raw: string): string | null {
  try {
    const v = JSON.parse(raw) as unknown;
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
    const text = (v as { text?: unknown }).text;
    return typeof text === 'string' && text.trim() !== '' ? text.trim() : null;
  } catch {
    return null;
  }
}

/** The four labelled parts of a thesis draft (thesis-draft@1), citations removed, for prefilling the editor. */
export interface ThesisDraftParts {
  bull: string;
  bear: string;
  risks: string[];
  changeView: string;
  /** Citation ids used anywhere in the draft, in order of first use. */
  citations: string[];
}

const LABELS = ['Bull case:', 'Bear case:', 'Key risks:', 'What would change the view:'] as const;
const CITE = /\s*\[([A-Z]\d+(?:\s*,\s*[A-Z]\d+)*)\]/g;

/** Removes `[F1]`-style citations and tidies the spacing they leave. */
export function stripCitations(text: string): string {
  return text
    .replace(CITE, '')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Splits a draft into its labelled parts. Returns null when any label is missing, so a malformed draft is never
 * offered as a starting point. Key risks become one item per sentence.
 */
export function parseThesisDraft(text: string): ThesisDraftParts | null {
  const at = LABELS.map((l) => text.indexOf(l));
  if (at.some((i) => i < 0)) return null;
  for (let i = 1; i < at.length; i++) if ((at[i] ?? 0) < (at[i - 1] ?? 0)) return null;
  const part = (i: number) =>
    text
      .slice((at[i] ?? 0) + (LABELS[i]?.length ?? 0), i + 1 < at.length ? at[i + 1] : undefined)
      .trim();
  const citations: string[] = [];
  for (const m of text.matchAll(CITE))
    for (const id of (m[1] ?? '').split(',').map((s) => s.trim()))
      if (!citations.includes(id)) citations.push(id);
  const risks = part(2)
    .split(/(?<=[.!?])\s+/)
    .map((s) => stripCitations(s).replace(/\.$/, ''))
    .filter((s) => s.length > 0)
    .slice(0, 10);
  return {
    bull: stripCitations(part(0)),
    bear: stripCitations(part(1)),
    risks,
    changeView: stripCitations(part(3)),
    citations,
  };
}
