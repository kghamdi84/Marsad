/**
 * SEC Form 3, 4 and 5 ownership documents (the XML behind each insider filing). Element names were confirmed
 * on three real NVIDIA Form 4s recorded on 2026-11-24 (fixtures/sec/form4-*.json) and on real Form 3, 3/A, 5 and
 * 5/A documents recorded the same day (fixtures/sec/form3-*, form3A-*, form5-*, form5A-*). The 10b5-1 checkbox is
 * the document-level `aff10b5One`; a transaction's own footnote usually states the plan and its adoption date.
 * A Form 3 reports what an insider already holds (holdings, not trades) and can say outright that the person
 * owns nothing (`noSecuritiesOwned`); a Form 5 reports trades that were not reported earlier, sometimes years
 * late; an amendment (`/A`) can repeat what an earlier filing said.
 */
import { child, children, descendants, parseXml, text, XmlError, type XmlNode } from './xml.js';

export type Form4ParseErrorKind = 'xml' | 'shape' | 'value';
export class Form4ParseError extends Error {
  constructor(
    public kind: Form4ParseErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export interface InsiderOwner {
  cik: string;
  name: string;
  isDirector: boolean;
  isOfficer: boolean;
  officerTitle: string | null;
  isTenPercentOwner: boolean;
  isOther: boolean;
}

export interface InsiderTransaction {
  table: 'non-derivative' | 'derivative';
  securityTitle: string;
  /** ISO date of the trade (ET). */
  date: string;
  /** SEC transaction code, for example `S`. */
  code: string;
  shares: number | null;
  /** Price per share as reported; null when blank, and zero for gifts and grants. */
  pricePerShare: number | null;
  acquiredDisposed: 'A' | 'D' | null;
  sharesAfter: number | null;
  ownership: 'D' | 'I' | null;
  /** Derivative only: the exercise or conversion price. */
  exercisePrice: number | null;
  /** Texts of the footnotes this transaction refers to. */
  footnotes: string[];
  /** Shares times price, in dollars, computed here. Null when either is missing or the price is zero. */
  valueUsd: number | null;
}

/** One line of a Form 3 or Form 5 holdings table: what the insider holds, not a trade. */
export interface InsiderHolding {
  table: 'non-derivative' | 'derivative';
  securityTitle: string;
  /** Shares owned after the report. Null for most derivative rows, which give `underlyingShares` instead. */
  shares: number | null;
  ownership: 'D' | 'I' | null;
  /** For indirect ownership, how: for example "By GV 2019 L.P.". */
  natureOfOwnership: string | null;
  /** Derivative only. Null when the filing gives the price only in a footnote (restricted stock units). */
  exercisePrice: number | null;
  /** ISO dates when the filing states one; often the date is only in a footnote, then null. */
  exerciseDate: string | null;
  expirationDate: string | null;
  underlyingTitle: string | null;
  underlyingShares: number | null;
  footnotes: string[];
}

export interface Form4Document {
  documentType: string;
  periodOfReport: string;
  issuer: { cik: string; name: string; symbol: string | null };
  owners: InsiderOwner[];
  /** The 10b5-1 checkbox: true or false when the filing has it, null for older forms without it. */
  plan10b5: boolean | null;
  transactions: InsiderTransaction[];
  /** Holdings tables (Form 3, and some Form 5 and Form 4 documents). */
  holdings: InsiderHolding[];
  /** Form 3 only: true when the filing states that the person owns no securities. Null when it has no such flag. */
  noSecuritiesOwned: boolean | null;
  /** True for 3/A, 4/A and 5/A. An amendment can repeat what the original said. */
  isAmendment: boolean;
  /** The date the original was submitted, stated by an amendment. */
  dateOfOriginalSubmission: string | null;
  footnotes: Record<string, string>;
}

function flag(node: XmlNode | null, path: string): boolean {
  const v = text(node, path);
  return v === '1' || v?.toLowerCase() === 'true';
}

function flagOrNull(node: XmlNode | null, path: string): boolean | null {
  const v = text(node, path);
  return v === null ? null : v === '1' || v.toLowerCase() === 'true';
}

function number(node: XmlNode | null, path: string): number | null {
  const v = text(node, path);
  if (v === null) return null;
  const n = Number(v.replace(/,/g, ''));
  if (!Number.isFinite(n)) throw new Form4ParseError('value', `Not a number at ${path}: ${v}`);
  return n;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function transaction(
  node: XmlNode,
  table: InsiderTransaction['table'],
  notes: Record<string, string>,
): InsiderTransaction {
  const date = text(node, 'transactionDate/value');
  const code = text(node, 'transactionCoding/transactionCode');
  if (!date || !DATE.test(date))
    throw new Form4ParseError('shape', 'Transaction without a valid date');
  if (!code) throw new Form4ParseError('shape', 'Transaction without a code');
  const shares =
    number(node, 'transactionAmounts/transactionShares/value') ??
    number(node, 'underlyingSecurity/underlyingSecurityShares/value');
  const price = number(node, 'transactionAmounts/transactionPricePerShare/value');
  const ad = text(node, 'transactionAmounts/transactionAcquiredDisposedCode/value');
  const own = text(node, 'ownershipNature/directOrIndirectOwnership/value');
  const ids = descendants(node, 'footnoteId').map((f) => f.attrs['id'] ?? '');
  return {
    table,
    securityTitle: text(node, 'securityTitle/value') ?? '',
    date,
    code,
    shares,
    pricePerShare: price,
    acquiredDisposed: ad === 'A' || ad === 'D' ? ad : null,
    sharesAfter: number(node, 'postTransactionAmounts/sharesOwnedFollowingTransaction/value'),
    ownership: own === 'D' || own === 'I' ? own : null,
    exercisePrice: number(node, 'conversionOrExercisePrice/value'),
    footnotes: [...new Set(ids)].map((id) => notes[id]).filter((s): s is string => s !== undefined),
    valueUsd: shares !== null && price !== null && price > 0 ? shares * price : null,
  };
}

function optionalDate(node: XmlNode, path: string): string | null {
  const v = text(node, path);
  return v !== null && DATE.test(v) ? v : null;
}

function holding(
  node: XmlNode,
  table: InsiderHolding['table'],
  notes: Record<string, string>,
): InsiderHolding {
  const own = text(node, 'ownershipNature/directOrIndirectOwnership/value');
  const ids = descendants(node, 'footnoteId').map((f) => f.attrs['id'] ?? '');
  return {
    table,
    securityTitle: text(node, 'securityTitle/value') ?? '',
    shares: number(node, 'postTransactionAmounts/sharesOwnedFollowingTransaction/value'),
    ownership: own === 'D' || own === 'I' ? own : null,
    natureOfOwnership: text(node, 'ownershipNature/natureOfOwnership/value'),
    exercisePrice: number(node, 'conversionOrExercisePrice/value'),
    exerciseDate: optionalDate(node, 'exerciseDate/value'),
    expirationDate: optionalDate(node, 'expirationDate/value'),
    underlyingTitle: text(node, 'underlyingSecurity/underlyingSecurityTitle/value'),
    underlyingShares: number(node, 'underlyingSecurity/underlyingSecurityShares/value'),
    footnotes: [...new Set(ids)].map((id) => notes[id]).filter((s): s is string => s !== undefined),
  };
}

/** Reads one ownership document. Anything unreadable throws a Form4ParseError, never a partial result. */
export function parseForm4(xml: string): Form4Document {
  let root: XmlNode;
  try {
    root = parseXml(xml);
  } catch (e) {
    throw new Form4ParseError('xml', e instanceof XmlError ? e.message : String(e));
  }
  if (root.name !== 'ownershipDocument')
    throw new Form4ParseError('shape', `Root is ${root.name}, not ownershipDocument`);
  const documentType = text(root, 'documentType');
  const period = text(root, 'periodOfReport');
  const issuerCik = text(root, 'issuer/issuerCik');
  if (!documentType || !['3', '4', '5', '3/A', '4/A', '5/A'].includes(documentType))
    throw new Form4ParseError('shape', `Unexpected documentType ${documentType}`);
  if (!period || !DATE.test(period)) throw new Form4ParseError('shape', 'No valid periodOfReport');
  if (!issuerCik) throw new Form4ParseError('shape', 'No issuer CIK');

  const owners = children(root, 'reportingOwner').map((o): InsiderOwner => {
    const rel = child(o, 'reportingOwnerRelationship');
    return {
      cik: text(o, 'reportingOwnerId/rptOwnerCik') ?? '',
      name: text(o, 'reportingOwnerId/rptOwnerName') ?? '',
      isDirector: flag(rel, 'isDirector'),
      isOfficer: flag(rel, 'isOfficer'),
      officerTitle: text(rel, 'officerTitle'),
      isTenPercentOwner: flag(rel, 'isTenPercentOwner'),
      isOther: flag(rel, 'isOther'),
    };
  });
  if (owners.length === 0) throw new Form4ParseError('shape', 'No reporting owner');

  const footnotes: Record<string, string> = {};
  for (const f of children(root, 'footnotes/footnote'))
    if (f.attrs['id']) footnotes[f.attrs['id']] = f.text;

  const plan = text(root, 'aff10b5One');
  return {
    documentType,
    periodOfReport: period,
    issuer: {
      cik: issuerCik,
      name: text(root, 'issuer/issuerName') ?? '',
      symbol: text(root, 'issuer/issuerTradingSymbol'),
    },
    owners,
    plan10b5: plan === null ? null : plan === '1' || plan.toLowerCase() === 'true',
    transactions: [
      ...children(root, 'nonDerivativeTable/nonDerivativeTransaction').map((n) =>
        transaction(n, 'non-derivative', footnotes),
      ),
      ...children(root, 'derivativeTable/derivativeTransaction').map((n) =>
        transaction(n, 'derivative', footnotes),
      ),
    ],
    holdings: [
      ...children(root, 'nonDerivativeTable/nonDerivativeHolding').map((n) =>
        holding(n, 'non-derivative', footnotes),
      ),
      ...children(root, 'derivativeTable/derivativeHolding').map((n) =>
        holding(n, 'derivative', footnotes),
      ),
    ],
    noSecuritiesOwned: flagOrNull(root, 'noSecuritiesOwned'),
    isAmendment: documentType.endsWith('/A'),
    dateOfOriginalSubmission: optionalDate(root, 'dateOfOriginalSubmission'),
    footnotes,
  };
}

export interface Form4Summary {
  /** Net shares by transaction code, for example `{ S: -30000 }`; disposals count negative. */
  netSharesByCode: Record<string, number>;
  /** Dollar value of open-market purchases (P) and sales (S): shares times price, from the reported prices. */
  purchasedUsd: number;
  soldUsd: number;
}

/** Totals for one document. Only non-derivative rows count; the sign comes from the acquired or disposed code. */
export function summarizeForm4(doc: Form4Document): Form4Summary {
  const net: Record<string, number> = {};
  let purchased = 0;
  let sold = 0;
  for (const t of doc.transactions) {
    if (t.table !== 'non-derivative' || t.shares === null) continue;
    const sign = t.acquiredDisposed === 'D' ? -1 : 1;
    net[t.code] = (net[t.code] ?? 0) + sign * t.shares;
    if (t.code === 'P' && t.valueUsd !== null) purchased += t.valueUsd;
    if (t.code === 'S' && t.valueUsd !== null) sold += t.valueUsd;
  }
  return { netSharesByCode: net, purchasedUsd: purchased, soldUsd: sold };
}

export interface InsiderTradeLine {
  table: 'non-derivative' | 'derivative';
  /** ISO trade date. */
  date: string;
  code: string;
  shares: number | null;
  valueUsd: number | null;
  /** True for a 3/A, 4/A or 5/A: it can repeat an earlier filing. */
  isAmendment: boolean;
}

export interface RecentOpenMarket {
  soldShares: number;
  soldUsd: number;
  boughtShares: number;
  boughtUsd: number;
  /** Open-market lines inside the window left out because they come from an amendment. */
  amendmentLines: number;
}

/**
 * Open-market sales (S) and purchases (P) on or after `since` (an ISO date), from shares and the reported price.
 * Derivative rows are left out. Lines from an amendment are listed by the page but not added to the totals: an
 * amendment usually repeats an earlier filing, and the original may or may not be stored, so adding both would
 * count one trade twice. Dates are trade dates, so a late Form 5 reporting an old trade never counts as recent.
 */
export function summarizeRecentOpenMarket(
  lines: readonly InsiderTradeLine[],
  since: string,
): RecentOpenMarket {
  const out: RecentOpenMarket = {
    soldShares: 0,
    soldUsd: 0,
    boughtShares: 0,
    boughtUsd: 0,
    amendmentLines: 0,
  };
  for (const l of lines) {
    if (l.table !== 'non-derivative' || l.date < since || l.shares === null) continue;
    if (l.code !== 'S' && l.code !== 'P') continue;
    if (l.isAmendment) {
      out.amendmentLines += 1;
      continue;
    }
    if (l.code === 'S') {
      out.soldShares += l.shares;
      out.soldUsd += l.valueUsd ?? 0;
    } else {
      out.boughtShares += l.shares;
      out.boughtUsd += l.valueUsd ?? 0;
    }
  }
  return out;
}
