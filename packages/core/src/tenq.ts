/**
 * Quarterly risk-factor updates (tenq-1, ADR 0036): Part II, Item 1A of a 10-Q, read from the filing's own HTML.
 * Pure: the job downloads the document. A 10-Q either lists changes to the risk factors in the last annual report
 * or says there were no material changes; both are shown as filed, and two quarters are compared sentence by
 * sentence with the 10-K engine (riskfactors.ts).
 */
export const TENQ_VERSION = 'tenq-1';

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '\u2019',
  lsquo: '\u2018',
  rdquo: '\u201d',
  ldquo: '\u201c',
  ndash: String.fromCharCode(0x2013),
  mdash: String.fromCharCode(0x2014),
  bull: '\u2022',
};

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code =
        e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Filing HTML to plain text: hidden inline-XBRL headers, scripts and styles removed; blocks become new lines. */
export function htmlToText(html: string): string {
  return decode(
    html
      .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, ' ')
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Headings start a line; a mid-sentence cross-reference ("see Item 1A, Risk Factors") is not a heading.
const HEADING = /(?:^|\n)[ \t]*item\s*1a\.?\s*[-:\u2013\u2014]?\s*risk\s+factors[ \t.]*(?=\n|$)/gi;
const NEXT = /(?:^|\n)[ \t]*item\s*2\.?\s*[-:\u2013\u2014]?\s*(unregistered|issuer)/gi;
const NO_CHANGE =
  /(no|not been any) material changes?\s+(to|from|in)\s+(the|our)\s+(previously disclosed\s+)?risk factors/i;

export interface QuarterlyRiskFactors {
  text: string;
  /** The section says, without exceptions, that there were no material changes from the annual report. */
  noMaterialChanges: boolean;
}

/**
 * Part II, Item 1A from a 10-Q's text: of every "Item 1A. Risk Factors" heading, the one followed by the longest
 * stretch before "Item 2. Unregistered ..." (the table of contents repeats the heading with only a page number).
 * Null when no such section is found, so a filing Marsad cannot read is said to be unreadable, not empty.
 */
export function extractQuarterlyRiskFactors(text: string): QuarterlyRiskFactors | null {
  let best: { start: number; end: number } | null = null;
  for (const h of text.matchAll(HEADING)) {
    const start = (h.index ?? 0) + h[0].length;
    NEXT.lastIndex = start;
    const n = NEXT.exec(text);
    if (!n) continue;
    if (!best || n.index - start > best.end - best.start) best = { start, end: n.index };
  }
  if (!best) return null;
  const body = text
    .slice(best.start, best.end)
    .replace(/^[\s.:\u2013\u2014-]+/, '')
    .trim();
  if (body.length < 20) return null;
  // "Other than the risk factors below, there have been no material changes" lists changes: not "no change".
  const qualified = /(other than|except)[^.]{0,120}(no|not been any) material changes?/i.test(body);
  return { text: body, noMaterialChanges: NO_CHANGE.test(body) && !qualified };
}
