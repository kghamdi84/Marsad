/**
 * SEC Form 3, 4 and 5 ownership documents (the XML behind each insider filing). Element names were confirmed
 * on three real NVIDIA Form 4s recorded on 2026-11-24 (fixtures/sec/form4-*.json). The 10b5-1 checkbox is the
 * document-level `aff10b5One`; a transaction's own footnote usually states the plan and its adoption date.
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

export interface Form4Document {
  documentType: string;
  periodOfReport: string;
  issuer: { cik: string; name: string; symbol: string | null };
  owners: InsiderOwner[];
  /** The 10b5-1 checkbox: true or false when the filing has it, null for older forms without it. */
  plan10b5: boolean | null;
  transactions: InsiderTransaction[];
  footnotes: Record<string, string>;
}

function flag(node: XmlNode | null, path: string): boolean {
  const v = text(node, path);
  return v === '1' || v?.toLowerCase() === 'true';
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
