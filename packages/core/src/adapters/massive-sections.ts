/**
 * Massive's annual-report sections: clean plain text of Item 1 (business) and Item 1A (risk factors) from each
 * 10-K, which keeps this code from parsing raw filing HTML. Confirmed on a real NVIDIA response recorded
 * 2026-11-24 (fixtures/massive/sections-NVDA-risk_factors.json). Coverage has gaps (NVDA returned 2026, 2025 and
 * then 2017), so a year-over-year comparison must check the period dates, never assume consecutive rows.
 * The text is the filing's own words: untrusted if it is ever given to a model.
 */
import { HttpClient } from '../http.js';
import { massiveCall, type MassiveConfig } from './massive.js';
import type { AdapterResult } from './result.js';

const TICKER = /^[A-Z][A-Z0-9.-]{0,9}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type AnnualSectionName = 'business' | 'risk_factors';

export interface AnnualSection {
  cik: string;
  ticker: string;
  section: AnnualSectionName;
  filingDate: string;
  /** The fiscal year end the 10-K covers. */
  periodEnd: string;
  text: string;
  /** The filing on sec.gov. */
  filingUrl: string;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** The newest `limit` 10-K sections of one kind for a ticker, newest fiscal year first. */
export function fetchAnnualSections(
  http: HttpClient,
  cfg: MassiveConfig,
  ticker: string,
  section: AnnualSectionName,
  limit = 2,
): Promise<AdapterResult<AnnualSection[]>> {
  if (!TICKER.test(ticker)) throw new RangeError(`Bad ticker: ${ticker}`);
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new RangeError('limit is 1 to 10');
  const path = `/stocks/filings/10-K/vX/sections?ticker=${ticker}&section=${section}&limit=${limit}&sort=period_end.desc`;
  // Not cached: each response is about 115 KB and the job runs rarely.
  return massiveCall(http, cfg, path, '/stocks/filings/10-K/vX/sections', 0, (items) => {
    const out: AnnualSection[] = [];
    for (const it of items) {
      const r = it as Record<string, unknown>;
      const cik = str(r['cik']);
      const filingDate = str(r['filing_date']);
      const periodEnd = str(r['period_end']);
      const text = str(r['text']);
      const url = str(r['filing_url']);
      if (
        !cik ||
        !/^\d{10}$/.test(cik) ||
        !filingDate ||
        !DATE.test(filingDate) ||
        !periodEnd ||
        !DATE.test(periodEnd) ||
        !text ||
        !url ||
        r['section'] !== section ||
        typeof r['ticker'] !== 'string'
      )
        return null;
      out.push({
        cik,
        ticker: r['ticker'],
        section,
        filingDate,
        periodEnd,
        text,
        filingUrl: url,
      });
    }
    const newest = out.reduce((m, s) => (s.filingDate > m ? s.filingDate : m), '');
    return { value: out, asOf: newest ? new Date(`${newest}T00:00:00Z`) : cfg.now() };
  });
}
