/**
 * Massive endpoints behind the universe breadth (ADR 0010): one session of the whole US market (grouped daily,
 * unadjusted), all-market splits by execution date, and the common stocks and ETFs as of a date. Shapes confirmed on
 * real responses recorded 2026-11-25 with the project key (fixtures/massive/grouped-*, splits-*, tickers-*).
 */
import type { ShareChange } from '../breadth.js';
import { HttpClient } from '../http.js';
import { massiveCall, type MassiveConfig } from './massive.js';
import { failure, type AdapterResult } from './result.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function checkDate(d: string): void {
  if (!DATE.test(d)) throw new RangeError('date must be YYYY-MM-DD');
}

export interface MarketRow {
  ticker: string;
  close: number;
  volume: number;
}

/**
 * Every US ticker's unadjusted close and volume for one session. An empty list means the market was closed that day.
 * Unadjusted on purpose: splits are applied from the stored split history, so a stored session never changes.
 */
export function fetchGroupedDaily(
  http: HttpClient,
  cfg: MassiveConfig,
  date: string,
): Promise<AdapterResult<MarketRow[]>> {
  checkDate(date);
  const path = `/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=false`;
  return massiveCall(
    http,
    cfg,
    path,
    '/v2/aggs/grouped/locale/us/market/stocks/{date}',
    0,
    (items) => {
      const out: MarketRow[] = [];
      for (const it of items) {
        const r = it as Record<string, unknown>;
        const c = num(r['c']);
        const v = num(r['v']);
        if (typeof r['T'] !== 'string' || c === null || v === null) return null;
        out.push({ ticker: r['T'], close: c, volume: v });
      }
      return { value: out, asOf: new Date(`${date}T21:00:00Z`) };
    },
    undefined,
    closedMarket,
  );
}

/**
 * A market holiday (for example 2024-11-28, Thanksgiving) comes back with zero records and no `results` field.
 * Only a successful status with a count of exactly zero counts as closed; anything else stays an error.
 */
export function closedMarket(json: unknown): boolean {
  if (typeof json !== 'object' || json === null) return false;
  const b = json as Record<string, unknown>;
  const ok = b['status'] === 'OK' || b['status'] === 'DELAYED';
  const zero =
    b['resultsCount'] === 0 || (b['resultsCount'] === undefined && b['queryCount'] === 0);
  return ok && zero && !('results' in b);
}

/** Path and query of a vendor `next_url`, without any key, for the next page through the same client. */
export function nextPagePath(nextUrl: unknown): string | null {
  if (typeof nextUrl !== 'string' || nextUrl === '') return null;
  const m = /^https:\/\/[^/]+(\/[^?#]*)(\?[^#]*)?/.exec(nextUrl);
  if (!m) return null;
  const query = (m[2] ?? '')
    .replace(/^\?/, '')
    .split('&')
    .filter((kv) => kv !== '' && !/^apiKey=/i.test(kv))
    .join('&');
  return `${m[1] as string}${query ? `?${query}` : ''}`;
}

/** Fetches a paged endpoint, following `next_url`, each page once. Stops at the first failure, which it returns. */
export async function paged<T>(
  http: HttpClient,
  cfg: MassiveConfig,
  firstPath: string,
  endpoint: string,
  parseItems: (items: unknown[]) => T[] | null,
  maxPages: number,
): Promise<AdapterResult<T[]>> {
  const all: T[] = [];
  let path: string | null = firstPath;
  let pages = 0;
  let latencyMs = 0;
  while (path !== null) {
    if (pages >= maxPages)
      return failure(
        'Massive',
        'invalid-response',
        `stopped after ${maxPages} pages of ${endpoint}`,
      );
    let next: string | null = null;
    const r: AdapterResult<T[]> = await massiveCall(
      http,
      cfg,
      path,
      endpoint,
      0,
      (items) => {
        const parsed = parseItems(items);
        return parsed === null ? null : { value: parsed, asOf: cfg.now() };
      },
      (json) => {
        next = nextPagePath((json as { next_url?: unknown }).next_url);
      },
    );
    if (!r.ok) return r;
    all.push(...(r.data.value ?? []));
    latencyMs += r.latencyMs;
    pages += 1;
    path = next;
  }
  return {
    ok: true,
    data: {
      value: all,
      provenance: {
        source: 'massive',
        endpoint,
        asOf: cfg.now().toISOString(),
        fetchedAt: cfg.now().toISOString(),
        planTier: cfg.planTier,
      },
    },
    latencyMs,
    fromCache: false,
  };
}

/** A split or stock dividend from the all-market feed, with the vendor's identifier so it can be stored once. */
export interface MarketSplit extends ShareChange {
  vendorId: string;
  adjustmentType: string;
}

/** Every split and stock dividend in the whole market executed on or after `from`. */
export function fetchSplitsSince(
  http: HttpClient,
  cfg: MassiveConfig,
  from: string,
): Promise<AdapterResult<MarketSplit[]>> {
  checkDate(from);
  return paged(
    http,
    cfg,
    `/stocks/v1/splits?execution_date.gte=${from}&limit=5000&sort=execution_date.asc`,
    '/stocks/v1/splits',
    (items) => {
      const out: MarketSplit[] = [];
      for (const it of items) {
        const r = it as Record<string, unknown>;
        const f = num(r['split_from']);
        const t = num(r['split_to']);
        const d = r['execution_date'];
        if (
          typeof r['ticker'] !== 'string' ||
          typeof r['id'] !== 'string' ||
          typeof d !== 'string' ||
          !DATE.test(d) ||
          f === null ||
          t === null
        )
          return null;
        out.push({
          ticker: r['ticker'],
          executionDate: d,
          splitFrom: f,
          splitTo: t,
          vendorId: r['id'],
          adjustmentType: typeof r['adjustment_type'] === 'string' ? r['adjustment_type'] : '',
        });
      }
      return out;
    },
    20,
  );
}

/** The tickers of one type (`CS` common stock or `ETF`) that traded on `date`, so delisted names are included then. */
export function fetchTickersOfType(
  http: HttpClient,
  cfg: MassiveConfig,
  type: 'CS' | 'ETF',
  date: string,
): Promise<AdapterResult<string[]>> {
  checkDate(date);
  return paged(
    http,
    cfg,
    `/v3/reference/tickers?market=stocks&type=${type}&date=${date}&active=true&limit=1000`,
    '/v3/reference/tickers',
    (items) => {
      const out: string[] = [];
      for (const it of items) {
        const r = it as Record<string, unknown>;
        if (typeof r['ticker'] !== 'string' || r['type'] !== type) return null;
        out.push(r['ticker']);
      }
      return out;
    },
    30,
  );
}
