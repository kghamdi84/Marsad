/**
 * ETF holdings from SEC Form N-PORT (etf-1, ADR 0038), for look-through exposure and ETF overlap. Pure: the job
 * downloads each fund's newest public NPORT-P document. Public N-PORT reports are quarterly and appear up to 60
 * days after the month they describe, so every figure carries its report date.
 */
import { companyKey } from './holders.js';

export const ETF_VERSION = 'etf-1';

export interface NportHolding {
  name: string;
  cusip: string | null;
  isin: string | null;
  /** Share of the fund's net assets, as a fraction (N-PORT reports percent). */
  weight: number;
  valueUsd: number;
  /** EC is common equity; others (cash, futures) are kept but never matched to a ticker. */
  assetCat: string;
}

export interface NportReport {
  reportDate: string | null;
  netAssets: number | null;
  holdings: NportHolding[];
}

const tag = (block: string, name: string): string | null => {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block);
  return m ? (m[1] ?? '').trim() : null;
};
const attr = (block: string, name: string): string | null => {
  const m = new RegExp(`<${name}\\s+value="([^"]*)"`).exec(block);
  return m ? (m[1] ?? '') : null;
};
const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/** Reads an NPORT-P primary document; throws when it has no holdings section. */
export function parseNport(xml: string): NportReport {
  const blocks = xml.match(/<invstOrSec>[\s\S]*?<\/invstOrSec>/g) ?? [];
  if (blocks.length === 0) throw new Error('N-PORT document has no holdings');
  const holdings = blocks.map((b) => {
    const cusip = tag(b, 'cusip');
    return {
      name: decodeXml(tag(b, 'name') ?? ''),
      cusip: cusip && /^[0-9A-Z]{9}$/.test(cusip) ? cusip : null,
      isin: attr(b, 'isin'),
      weight: Number(tag(b, 'pctVal') ?? 'NaN') / 100,
      valueUsd: Number(tag(b, 'valUSD') ?? 'NaN'),
      assetCat: tag(b, 'assetCat') ?? '',
    };
  });
  const bad = holdings.findIndex((h) => !Number.isFinite(h.weight) || !Number.isFinite(h.valueUsd));
  if (bad >= 0) throw new Error(`N-PORT holding ${bad} has no numeric value or weight`);
  const net = tag(xml, 'netAssets');
  return {
    reportDate: tag(xml, 'repPdDate'),
    netAssets: net === null ? null : Number(net),
    holdings,
  };
}

/**
 * Ticker for each equity holding, by company-name key against the SEC ticker list. A key shared by several
 * tickers (share classes, like Alphabet's GOOGL and GOOG) is matched by CUSIP when the caller knows it, else left
 * unmatched rather than guessed.
 */
export function matchTickers(
  holdings: readonly NportHolding[],
  companies: readonly { ticker: string; name: string }[],
  cusipToTicker: ReadonlyMap<string, string> = new Map(),
): (string | null)[] {
  const byKey = new Map<string, string[]>();
  for (const c of companies) {
    const k = companyKey(c.name).join(' ');
    byKey.set(k, [...(byKey.get(k) ?? []), c.ticker]);
  }
  return holdings.map((h) => {
    if (h.assetCat !== 'EC') return null;
    const known = h.cusip ? cusipToTicker.get(h.cusip) : undefined;
    if (known) return known;
    const hits = byKey.get(companyKey(h.name).join(' ')) ?? [];
    return hits.length === 1 ? (hits[0] as string) : null;
  });
}

/**
 * Overlap of two funds: the sum over shared securities (by CUSIP) of the smaller weight. 1 means identical
 * holdings in identical weights, 0 nothing in common.
 */
export function etfOverlap(
  a: readonly { cusip: string | null; weight: number }[],
  b: readonly { cusip: string | null; weight: number }[],
): number {
  const wb = new Map<string, number>();
  for (const h of b) if (h.cusip) wb.set(h.cusip, (wb.get(h.cusip) ?? 0) + h.weight);
  const wa = new Map<string, number>();
  for (const h of a) if (h.cusip) wa.set(h.cusip, (wa.get(h.cusip) ?? 0) + h.weight);
  let s = 0;
  for (const [c, w] of wa) s += Math.min(w, wb.get(c) ?? 0);
  return s;
}

export interface LookThroughRow {
  ticker: string;
  direct: number;
  /** Dollars held through each fund: fund position value times the stock's weight in the fund. */
  viaEtfs: { etf: string; usd: number }[];
  total: number;
}

/**
 * Direct plus look-through dollars for each stock held directly. Positions are valued by the caller (shares times
 * the last close);
 * a fund without a stored N-PORT report contributes nothing and is listed by the caller as not covered.
 */
export function lookThrough(
  positions: readonly { ticker: string; value: number }[],
  etfWeights: ReadonlyMap<string, ReadonlyMap<string, number>>,
): LookThroughRow[] {
  const funds = positions.filter((p) => etfWeights.has(p.ticker));
  // One row per stock held directly; what the funds add to it is shown beside it.
  const stocks = new Set(positions.filter((p) => !etfWeights.has(p.ticker)).map((p) => p.ticker));
  const rows = [...stocks].map((t) => {
    const direct = positions.filter((p) => p.ticker === t).reduce((a, p) => a + p.value, 0);
    const viaEtfs = funds.flatMap((f) => {
      const w = etfWeights.get(f.ticker)?.get(t);
      return w ? [{ etf: f.ticker, usd: f.value * w }] : [];
    });
    return { ticker: t, direct, viaEtfs, total: direct + viaEtfs.reduce((a, v) => a + v.usd, 0) };
  });
  return rows.sort((x, y) => y.total - x.total || x.ticker.localeCompare(y.ticker));
}
