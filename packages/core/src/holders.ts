/**
 * Institutional holders from the SEC Form 13F data sets (holders-1, ADR 0037). Pure: the job streams the data set's
 * INFOTABLE, SUBMISSION and COVERPAGE files and hands the matching rows here. 13F reports long positions as of a
 * quarter end, filed up to 45 days later, so every list carries its period and the disclosure lag.
 */
export const HOLDERS_VERSION = 'holders-2';

/**
 * A CUSIP counts only when it carries at least this share of a company's common-share lines. Real share classes and
 * pre-redomicile CUSIPs carry many lines (Rocket Lab's old CUSIP: 13 of 46 in the recorded sample); a filer's typo
 * (another company's CUSIP, an option code) carries one or two, and is left out and counted (holders-2).
 */
export const MIN_CUSIP_LINE_SHARE = 0.01;

const SUFFIXES = new Set([
  'INC',
  'CORP',
  'CORPORATION',
  'CO',
  'COMPANY',
  'LTD',
  'LIMITED',
  'PLC',
  'HOLDINGS',
  'HLDGS',
  'GROUP',
  'TECHNOLOGIES',
  'USA',
  'THE',
  'CLASS',
  'CL',
  'A',
  'COM',
]);

/** Issuer name as words: upper case, punctuation to spaces ("BigBear.ai Holdings, Inc." -> BIGBEAR AI HOLDINGS INC). */
export function issuerWords(name: string): string[] {
  return name
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/** The words that identify a company: its name without legal suffixes, at most the first three words. */
export function companyKey(name: string): string[] {
  const words = issuerWords(name);
  let end = words.length;
  while (end > 1 && SUFFIXES.has(words[end - 1] as string)) end--;
  return words.slice(0, Math.min(end, 3));
}

/** True when the issuer name starts with every key word, whole words only (MARA matches MARA HOLDINGS, not MARATHON). */
export function issuerMatches(issuer: string, key: readonly string[]): boolean {
  const w = issuerWords(issuer);
  return key.length > 0 && key.every((k, i) => w[i] === k);
}

/** Common stock lines only: no options, no principal amounts, no warrants, notes or preferred shares. */
export function isCommonShareLine(r: {
  titleOfClass: string;
  putCall: string;
  amountType: string;
}): boolean {
  return (
    r.putCall.trim() === '' &&
    r.amountType.trim().toUpperCase() === 'SH' &&
    !/\b(WT|WTS|WARRANTS?|NOTES?|BONDS?|PFD|PREFERRED|UNITS?|RIGHTS?|DEBT|CONV)\b/i.test(
      r.titleOfClass,
    ) &&
    // Warrants are often filed as "*W EXP 08/25/2028".
    !/^\s*\*\s*W\b|\bW EXP\b/i.test(r.titleOfClass)
  );
}

export interface InfoRow {
  accession: string;
  issuer: string;
  titleOfClass: string;
  cusip: string;
  value: number;
  shares: number;
  amountType: string;
  putCall: string;
}

export interface Filer {
  accession: string;
  cik: string;
  name: string;
  period: string;
  filingDate: string;
  type: string;
  amendment: boolean;
}

export interface Holder {
  cik: string;
  name: string;
  shares: number;
  valueUsd: number;
  /** Share of the shares all listed filers reported. */
  share: number;
  filingDate: string;
}

export interface HolderList {
  version: string;
  period: string;
  filers: number;
  totalShares: number;
  totalValueUsd: number;
  /** Every CUSIP counted, with its issuer name as filed and how many lines used it. */
  cusips: { cusip: string; issuer: string; lines: number }[];
  top: Holder[];
  /** Lines left out and why. */
  leftOut: {
    options: number;
    otherPeriod: number;
    amendments: number;
    notCommon: number;
    /** Lines under a CUSIP used by under 1% of the lines: most likely filer errors. */
    minorCusip: number;
  };
}

/** "30-JUN-2026" -> "2026-06-30"; null for anything else. */
export function secDate(s: string): string | null {
  const m = /^(\d{2})-([A-Z]{3})-(\d{4})$/.exec(s.trim().toUpperCase());
  if (!m) return null;
  const mon = [
    'JAN',
    'FEB',
    'MAR',
    'APR',
    'MAY',
    'JUN',
    'JUL',
    'AUG',
    'SEP',
    'OCT',
    'NOV',
    'DEC',
  ].indexOf(m[2] as string);
  return mon < 0 ? null : `${m[3]}-${String(mon + 1).padStart(2, '0')}-${m[1]}`;
}

/**
 * Holders of one company for the newest quarter in the rows: original 13F-HR reports only (amendments are left out
 * and counted), common-share lines only, under CUSIPs that carry at least 1% of those lines, summed per filer,
 * largest first.
 */
export function holderList(
  rows: readonly InfoRow[],
  filers: ReadonlyMap<string, Filer>,
  topN = 20,
): HolderList | null {
  const leftOut = { options: 0, otherPeriod: 0, amendments: 0, notCommon: 0, minorCusip: 0 };
  const periods = new Map<string, number>();
  for (const r of rows) {
    const f = filers.get(r.accession);
    if (f && f.type === '13F-HR' && !f.amendment)
      periods.set(f.period, (periods.get(f.period) ?? 0) + 1);
  }
  const period = [...periods.keys()].sort().at(-1);
  if (!period) return null;
  const byFiler = new Map<string, Holder>();
  const cusips = new Map<string, { cusip: string; issuer: string; lines: number }>();
  const kept: { r: InfoRow; f: Filer; cusip: string }[] = [];
  for (const r of rows) {
    const f = filers.get(r.accession);
    if (!f || f.type !== '13F-HR') continue;
    if (r.putCall.trim() !== '') {
      leftOut.options++;
      continue;
    }
    if (f.amendment) {
      leftOut.amendments++;
      continue;
    }
    if (f.period !== period) {
      leftOut.otherPeriod++;
      continue;
    }
    if (!isCommonShareLine(r)) {
      leftOut.notCommon++;
      continue;
    }
    // CUSIPs are case-insensitive; filers write both 67066G104 and 67066g104.
    const cusip = r.cusip.trim().toUpperCase();
    const c = cusips.get(cusip) ?? { cusip, issuer: r.issuer, lines: 0 };
    c.lines++;
    cusips.set(cusip, c);
    kept.push({ r, f, cusip });
  }
  const minLines = kept.length * MIN_CUSIP_LINE_SHARE;
  for (const [k, c] of cusips) if (c.lines < minLines) cusips.delete(k);
  for (const { r, f, cusip } of kept) {
    if (!cusips.has(cusip)) {
      leftOut.minorCusip++;
      continue;
    }
    const h = byFiler.get(f.cik) ?? {
      cik: f.cik,
      name: f.name,
      shares: 0,
      valueUsd: 0,
      share: 0,
      filingDate: f.filingDate,
    };
    h.shares += r.shares;
    h.valueUsd += r.value;
    byFiler.set(f.cik, h);
  }
  const all = [...byFiler.values()];
  const totalShares = all.reduce((s, h) => s + h.shares, 0);
  const totalValueUsd = all.reduce((s, h) => s + h.valueUsd, 0);
  for (const h of all) h.share = totalShares > 0 ? h.shares / totalShares : 0;
  all.sort((a, b) => b.shares - a.shares || a.name.localeCompare(b.name));
  return {
    version: HOLDERS_VERSION,
    period,
    filers: all.length,
    totalShares,
    totalValueUsd,
    cusips: [...cusips.values()].sort((a, b) => b.lines - a.lines),
    top: all.slice(0, topN),
    leftOut,
  };
}
