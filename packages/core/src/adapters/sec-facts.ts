/**
 * SEC EDGAR structured data: XBRL company facts (financial statements as filed) and the raw Form 4 documents.
 * Shapes confirmed on real NVIDIA responses recorded 2026-11-24 (fixtures/sec). Every fact keeps the accession
 * and filing date it came from, which is what makes point-in-time use possible: the same period reappears in
 * later filings, sometimes restated, and `fy` and `fp` describe the filing, not the period.
 */
import { normalizeCik } from '../corporate-actions.js';
import { HttpClient } from '../http.js';
import { parseForm4, Form4ParseError, type Form4Document } from '../form4.js';
import type { Sourced } from '../provenance.js';
import { failure, type AdapterResult } from './result.js';
import { assertDeclaredUserAgent, type SecConfig } from './sec.js';

export interface FinancialFact {
  taxonomy: string;
  concept: string;
  unit: string;
  /** Start of the period, or null for a point-in-time balance. */
  start: string | null;
  end: string;
  value: number;
  accession: string;
  form: string;
  fy: number | null;
  fp: string | null;
  /** The date the filing carrying this value was filed (ET calendar date). */
  filed: string;
  frame: string | null;
}

export interface CompanyFacts {
  cik: string;
  entityName: string;
  facts: FinancialFact[];
}

export class FactsParseError extends Error {}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Reads the company-facts JSON. A row that cannot be read is an error, not a gap. */
export function parseCompanyFacts(json: unknown): CompanyFacts {
  const root = json as { cik?: unknown; entityName?: unknown; facts?: unknown };
  if (
    typeof root?.cik !== 'number' ||
    typeof root.entityName !== 'string' ||
    typeof root.facts !== 'object' ||
    root.facts === null
  )
    throw new FactsParseError('Not a company facts document');
  const facts: FinancialFact[] = [];
  for (const [taxonomy, concepts] of Object.entries(root.facts as Record<string, unknown>)) {
    for (const [concept, body] of Object.entries(concepts as Record<string, unknown>)) {
      const units = (body as { units?: Record<string, unknown[]> }).units;
      if (!units) throw new FactsParseError(`${taxonomy}/${concept} has no units`);
      for (const [unit, rows] of Object.entries(units)) {
        for (const r of rows as Record<string, unknown>[]) {
          const where = `${taxonomy}/${concept} [${unit}]`;
          if (typeof r['end'] !== 'string' || !DATE.test(r['end']))
            throw new FactsParseError(`${where}: bad end date`);
          if (typeof r['val'] !== 'number' || !Number.isFinite(r['val']))
            throw new FactsParseError(`${where}: bad value`);
          if (
            typeof r['accn'] !== 'string' ||
            typeof r['filed'] !== 'string' ||
            !DATE.test(r['filed'])
          )
            throw new FactsParseError(`${where}: missing accession or filing date`);
          const start = r['start'];
          if (start !== undefined && (typeof start !== 'string' || !DATE.test(start)))
            throw new FactsParseError(`${where}: bad start date`);
          facts.push({
            taxonomy,
            concept,
            unit,
            start: typeof start === 'string' ? start : null,
            end: r['end'],
            value: r['val'],
            accession: r['accn'],
            form: String(r['form'] ?? ''),
            fy: typeof r['fy'] === 'number' ? r['fy'] : null,
            fp: typeof r['fp'] === 'string' ? r['fp'] : null,
            filed: r['filed'],
            frame: typeof r['frame'] === 'string' ? r['frame'] : null,
          });
        }
      }
    }
  }
  return { cik: normalizeCik(root.cik), entityName: root.entityName, facts };
}

export async function fetchCompanyFacts(
  http: HttpClient,
  cfg: SecConfig,
  cik: string | number,
): Promise<AdapterResult<CompanyFacts>> {
  assertDeclaredUserAgent(cfg.userAgent);
  const padded = normalizeCik(cik);
  const res = await http.get(
    `${cfg.baseUrl ?? 'https://data.sec.gov'}/api/xbrl/companyfacts/CIK${padded}.json`,
    {
      headers: { 'User-Agent': cfg.userAgent, Accept: 'application/json' },
      cacheTtlMs: 6 * 3600_000,
    },
  );
  if (!res.ok) return failure('SEC EDGAR', res.kind, res.message);
  let value: CompanyFacts;
  try {
    value = parseCompanyFacts(JSON.parse(res.body));
  } catch (e) {
    return failure(
      'SEC EDGAR',
      'invalid-response',
      e instanceof Error ? e.message : 'unreadable company facts',
    );
  }
  const newest = value.facts.reduce((m, f) => (f.filed > m ? f.filed : m), '');
  const data: Sourced<CompanyFacts> = {
    value,
    provenance: {
      source: 'sec_edgar',
      endpoint: '/api/xbrl/companyfacts/CIK{cik}.json',
      asOf: newest ? `${newest}T00:00:00.000Z` : cfg.now().toISOString(),
      fetchedAt: cfg.now().toISOString(),
      planTier: 'real-time',
    },
  };
  return { ok: true, data, latencyMs: res.latencyMs, fromCache: res.fromCache };
}

/**
 * The raw ownership XML of an insider filing. The filing index lists the rendered `xsl...` copy as the primary
 * document; the XML itself sits in the same folder without that prefix.
 */
export function form4Url(cik: string | number, accession: string, primaryDocument: string): string {
  const doc = primaryDocument.replace(/^xsl[^/]*\//, '');
  if (!/\.xml$/i.test(doc))
    throw new RangeError(`Not an ownership XML document: ${primaryDocument}`);
  return `/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, '')}/${doc}`;
}

export async function fetchForm4(
  http: HttpClient,
  cfg: SecConfig,
  cik: string | number,
  accession: string,
  primaryDocument: string,
): Promise<AdapterResult<Form4Document>> {
  assertDeclaredUserAgent(cfg.userAgent);
  const path = form4Url(cik, accession, primaryDocument);
  const res = await http.get(`${cfg.baseUrl ?? 'https://www.sec.gov'}${path}`, {
    headers: { 'User-Agent': cfg.userAgent, Accept: 'application/xml,text/xml,*/*' },
    cacheTtlMs: 24 * 3600_000,
  });
  if (!res.ok) return failure('SEC EDGAR', res.kind, res.message);
  let doc: Form4Document;
  try {
    doc = parseForm4(res.body);
  } catch (e) {
    return failure(
      'SEC EDGAR',
      'invalid-response',
      e instanceof Form4ParseError ? `${e.kind}: ${e.message}` : 'unreadable Form 4',
    );
  }
  const data: Sourced<Form4Document> = {
    value: doc,
    provenance: {
      source: 'sec_edgar',
      endpoint: '/Archives/edgar/data/{cik}/{accession}/{document}',
      asOf: `${doc.periodOfReport}T00:00:00.000Z`,
      fetchedAt: cfg.now().toISOString(),
      planTier: 'real-time',
    },
  };
  return { ok: true, data, latencyMs: res.latencyMs, fromCache: res.fromCache };
}
