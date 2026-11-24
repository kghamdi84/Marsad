/**
 * SEC EDGAR adapter (submissions API). Follows the SEC fair-access policy: every request declares a
 * User-Agent with a real contact, and the request rate stays well under the published 10 per second
 * (the caller builds the HttpClient with a bucket of at most 5 per second).
 *
 * The contact string comes from the SEC_USER_AGENT secret and is never hard-coded. Response shape
 * follows the documented `filings.recent` parallel arrays; the test body is synthetic until it is
 * re-recorded with the real contact string set.
 */
import { normalizeCik } from '../corporate-actions.js';
import { HttpClient } from '../http.js';
import type { Sourced } from '../provenance.js';
import { failure, type AdapterResult } from './result.js';

export interface SecConfig {
  /** For example "Marsad research <contact email>". Must contain a contact. */
  userAgent: string;
  now: () => Date;
  baseUrl?: string;
}

export interface Filing {
  accession: string;
  form: string;
  filingDate: string; // YYYY-MM-DD
  acceptedAt: string | null; // UTC ISO, when EDGAR accepted it
  primaryDocument: string | null;
  items: string[]; // 8-K item numbers, for example ["2.02", "9.01"]
}

/**
 * Rejects a User-Agent that clearly lacks what the SEC asks for: a company or application name followed
 * by an admin contact email, for example "Marsad research name@example.com" (SEC "Accessing EDGAR Data",
 * last reviewed by the SEC 2026-11-20). A misconfiguration therefore cannot send anonymous requests.
 */
export function assertDeclaredUserAgent(ua: string): void {
  const trimmed = ua.trim();
  const email = /[^\s@]+@[^\s@]+\.[^\s@]+/.exec(trimmed);
  const name = email ? trimmed.slice(0, email.index).trim() : '';
  if (!email || name.length < 3) {
    throw new RangeError(
      'SEC_USER_AGENT must be a name followed by a contact email, like "Marsad research name@example.com" (SEC fair-access policy)',
    );
  }
}

export async function fetchRecentFilings(
  http: HttpClient,
  cfg: SecConfig,
  cik: string | number,
): Promise<AdapterResult<Filing[]>> {
  assertDeclaredUserAgent(cfg.userAgent);
  const padded = normalizeCik(cik);
  const path = `/submissions/CIK${padded}.json`;
  const res = await http.get(`${cfg.baseUrl ?? 'https://data.sec.gov'}${path}`, {
    headers: { 'User-Agent': cfg.userAgent, Accept: 'application/json' },
    cacheTtlMs: 30_000,
  });
  if (!res.ok) return failure('SEC EDGAR', res.kind, res.message);
  let json: unknown;
  try {
    json = JSON.parse(res.body);
  } catch {
    return failure('SEC EDGAR', 'invalid-response', 'response was not JSON');
  }
  const recent = (json as { filings?: { recent?: Record<string, unknown> } }).filings?.recent;
  const col = (name: string): unknown[] | null =>
    Array.isArray(recent?.[name]) ? (recent?.[name] as unknown[]) : null;
  const accession = col('accessionNumber');
  const form = col('form');
  const filingDate = col('filingDate');
  if (
    !accession ||
    !form ||
    !filingDate ||
    accession.length !== form.length ||
    form.length !== filingDate.length
  ) {
    return failure(
      'SEC EDGAR',
      'invalid-response',
      'filings.recent columns missing or of unequal length',
    );
  }
  const accepted = col('acceptanceDateTime');
  const docs = col('primaryDocument');
  const items = col('items');
  const out: Filing[] = [];
  for (let i = 0; i < accession.length; i += 1) {
    const d = filingDate[i];
    if (typeof accession[i] !== 'string' || typeof form[i] !== 'string' || typeof d !== 'string') {
      return failure('SEC EDGAR', 'invalid-response', `bad filing row ${i}`);
    }
    const acc = accepted?.[i];
    const itemText = items?.[i];
    out.push({
      accession: accession[i] as string,
      form: form[i] as string,
      filingDate: d,
      acceptedAt: typeof acc === 'string' && acc ? new Date(acc).toISOString() : null,
      primaryDocument: typeof docs?.[i] === 'string' && docs[i] ? (docs[i] as string) : null,
      items:
        typeof itemText === 'string' && itemText ? itemText.split(',').map((s) => s.trim()) : [],
    });
  }
  const newest = out.reduce<string | null>(
    (m, f) => (f.acceptedAt && (!m || f.acceptedAt > m) ? f.acceptedAt : m),
    null,
  );
  const data: Sourced<Filing[]> = {
    value: out,
    provenance: {
      source: 'sec_edgar',
      endpoint: '/submissions/CIK{cik}.json',
      asOf: newest ?? cfg.now().toISOString(),
      fetchedAt: cfg.now().toISOString(),
      planTier: 'real-time',
    },
  };
  return { ok: true, data, latencyMs: res.latencyMs, fromCache: res.fromCache };
}

export interface CompanyRef {
  ticker: string;
  cik: string; // 10 digits
  name: string;
}

/**
 * Parses the SEC's ticker to CIK file (https://www.sec.gov/files/company_tickers.json): an object whose
 * values are `{ cik_str, ticker, title }`. When a ticker appears twice the first entry wins. The SEC
 * notes this file is updated periodically and its accuracy is not guaranteed.
 */
export function parseCompanyTickers(json: unknown): Map<string, CompanyRef> {
  const out = new Map<string, CompanyRef>();
  if (!json || typeof json !== 'object') return out;
  for (const v of Object.values(json as Record<string, unknown>)) {
    const r = v as Record<string, unknown>;
    if (
      typeof r['ticker'] !== 'string' ||
      (typeof r['cik_str'] !== 'number' && typeof r['cik_str'] !== 'string')
    )
      continue;
    const ticker = r['ticker'].toUpperCase();
    if (out.has(ticker)) continue;
    try {
      out.set(ticker, {
        ticker,
        cik: normalizeCik(r['cik_str']),
        name: typeof r['title'] === 'string' ? r['title'] : '',
      });
    } catch {
      // A malformed CIK is skipped rather than guessed.
    }
  }
  return out;
}

export async function fetchCompanyTickers(
  http: HttpClient,
  cfg: SecConfig,
): Promise<AdapterResult<CompanyRef[]>> {
  assertDeclaredUserAgent(cfg.userAgent);
  const res = await http.get(`${cfg.baseUrl ?? 'https://www.sec.gov'}/files/company_tickers.json`, {
    headers: { 'User-Agent': cfg.userAgent, Accept: 'application/json' },
    cacheTtlMs: 6 * 3600_000,
  });
  if (!res.ok) return failure('SEC EDGAR', res.kind, res.message);
  let json: unknown;
  try {
    json = JSON.parse(res.body);
  } catch {
    return failure('SEC EDGAR', 'invalid-response', 'response was not JSON');
  }
  const map = parseCompanyTickers(json);
  if (map.size === 0)
    return failure('SEC EDGAR', 'invalid-response', 'no companies in the ticker file');
  const data: Sourced<CompanyRef[]> = {
    value: [...map.values()],
    provenance: {
      source: 'sec_edgar',
      endpoint: '/files/company_tickers.json',
      asOf: cfg.now().toISOString(),
      fetchedAt: cfg.now().toISOString(),
      planTier: 'real-time',
    },
  };
  return { ok: true, data, latencyMs: res.latencyMs, fromCache: res.fromCache };
}
