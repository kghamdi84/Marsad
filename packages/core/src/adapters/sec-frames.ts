/**
 * SEC XBRL frames and the SEC ticker list (ADR 0035). A frame is one reported figure (for example us-gaap
 * GrossProfit in USD for calendar 2025) for every filer, from data.sec.gov/api/xbrl/frames (tickers map to CIKs
 * through fetchCompanyTickers in sec.ts). Same fair-access rules as the other SEC adapters: a declared User-Agent with a contact.
 * Shapes confirmed against the live service on 2026-11-25 (fixtures/sec, trimmed to a dozen companies).
 */
import { normalizeCik } from '../corporate-actions.js';
import type { HttpClient } from '../http.js';
import type { Sourced } from '../provenance.js';
import { failure, type AdapterResult } from './result.js';
import { assertDeclaredUserAgent, type SecConfig } from './sec.js';

export interface FrameRow {
  cik: string;
  entityName: string;
  value: number;
  /** Period end (instant or end of the duration), YYYY-MM-DD. */
  end: string;
  accession: string;
}

/** Validates and normalizes a frame body; throws on a shape the code does not know. */
export function parseFrame(json: unknown): FrameRow[] {
  const data = (json as { data?: unknown }).data;
  if (!Array.isArray(data)) throw new Error('frame has no data array');
  return data.map((d: Record<string, unknown>, i) => {
    const val = d['val'];
    const end = d['end'];
    if (typeof val !== 'number' || !Number.isFinite(val))
      throw new Error(`frame row ${i}: value is not a number`);
    if (typeof end !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(end))
      throw new Error(`frame row ${i}: end is not a date`);
    return {
      cik: normalizeCik(d['cik'] as number),
      entityName: String(d['entityName'] ?? ''),
      value: val,
      end,
      accession: String(d['accn'] ?? ''),
    };
  });
}

export async function fetchFrame(
  http: HttpClient,
  cfg: SecConfig,
  taxonomy: 'us-gaap' | 'dei',
  concept: string,
  unit: 'USD' | 'shares',
  period: string,
): Promise<AdapterResult<FrameRow[]>> {
  assertDeclaredUserAgent(cfg.userAgent);
  if (!/^[A-Za-z]+$/.test(concept) || !/^CY\d{4}(Q[1-4]I?)?$/.test(period))
    throw new RangeError(`Not a frame: ${concept} ${period}`);
  const endpoint = `/api/xbrl/frames/${taxonomy}/${concept}/${unit}/${period}.json`;
  const res = await http.get(`${cfg.baseUrl ?? 'https://data.sec.gov'}${endpoint}`, {
    headers: { 'User-Agent': cfg.userAgent, Accept: 'application/json' },
    cacheTtlMs: 6 * 3600_000,
  });
  if (!res.ok) return failure('SEC EDGAR', res.kind, res.message);
  let value: FrameRow[];
  try {
    value = parseFrame(JSON.parse(res.body));
  } catch (e) {
    return failure(
      'SEC EDGAR',
      'invalid-response',
      e instanceof Error ? e.message : 'unreadable frame',
    );
  }
  const data: Sourced<FrameRow[]> = {
    value,
    provenance: {
      source: 'sec_edgar',
      endpoint,
      asOf: cfg.now().toISOString(),
      fetchedAt: cfg.now().toISOString(),
      planTier: 'end-of-day',
    },
  };
  return { ok: true, data, latencyMs: res.latencyMs, fromCache: res.fromCache };
}
