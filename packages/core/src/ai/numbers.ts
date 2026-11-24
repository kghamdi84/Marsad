/** Finds the figures in generated text and their meaning (percent, dollars, a multiple, a magnitude). */

export interface NumberToken {
  /** The text as written, for example `$4.2B`. */
  raw: string;
  /** Value as written, signed, with the magnitude applied (4.2B is 4,200,000,000). */
  value: number;
  /** Digits after the decimal point as written; sets how far a rounded figure may differ from the fact. */
  decimals: number;
  magnitude: number;
  pct: boolean;
  usd: boolean;
  multiple: boolean;
  /** True when the text carries an explicit minus sign. */
  negative: boolean;
  /** The bare digits as written without sign, currency or magnitude (`4.2`), for label matching. */
  digits: string;
}

/** Names and codes whose digits are not figures: form types, index names, fiscal periods. */
const NOT_FIGURES: readonly RegExp[] = [
  /\b10b5-1\b/gi,
  /\b(?:10|8|6|20|13)-[A-Z]\b/g,
  /\b13[FDG](?:-[A-Z]+)?\b/g,
  /\bS-[134]\b/g,
  /\bSC 13[DG]\b/g,
  /\bQ[1-4]\b/g,
  /\bH[12]\b/g,
  /\bFY\s?\d{2,4}\b/g,
  /\bS&P 500\b/g,
  /\bNasdaq-100\b/g,
  /\bRussell (?:1000|2000|3000)\b/g,
  /\bDow 30\b/g,
  /\bForm [345]\b/g,
  /\b(?:Rule|Regulation|Section) [\w.()-]+/g,
];

const MAGNITUDES: Readonly<Record<string, number>> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  mn: 1e6,
  million: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
  t: 1e12,
  trillion: 1e12,
};

const TOKEN =
  /(?<![\w.$])([-−–+])?\s?(US\$|\$)?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)(?:(%)|\s?(percent)\b|(x|×)(?![A-Za-z])|([KMBT])(?![A-Za-z])|\s(thousand|million|billion|trillion|mn|bn)\b)?/gi;

/** Removes names and codes that contain digits but are not figures. */
export function stripNonFigures(text: string): string {
  let out = text;
  for (const re of NOT_FIGURES) out = out.replace(re, ' ');
  return out;
}

/** Every figure in the text, in order. Citation markers and form names must be removed first. */
export function extractNumbers(text: string): NumberToken[] {
  const out: NumberToken[] = [];
  for (const m of stripNonFigures(text).matchAll(TOKEN)) {
    const [raw, sign, dollar, digitsRaw, percentSign, percentWord, times, magLetter, magWord] = m;
    if (digitsRaw === undefined) continue;
    const clean = digitsRaw.replace(/,/g, '');
    const decimals = clean.includes('.') ? (clean.split('.')[1]?.length ?? 0) : 0;
    const magKey = (magLetter ?? magWord ?? '').toLowerCase();
    const magnitude = magKey ? (MAGNITUDES[magKey] ?? 1) : 1;
    const negative = sign !== undefined && sign !== '+';
    out.push({
      raw: raw.trim(),
      value: (negative ? -1 : 1) * Number(clean) * magnitude,
      decimals,
      magnitude,
      pct: percentSign !== undefined || percentWord !== undefined,
      usd: dollar !== undefined,
      multiple: times !== undefined,
      negative,
      digits: clean,
    });
  }
  return out;
}
