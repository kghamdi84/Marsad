/**
 * Massive (formerly Polygon.io) adapter. Endpoints and fields were confirmed with the Massive
 * connector's endpoint search and recorded in fixtures/massive on 2026-11-23.
 *
 * Authentication: `Authorization: Bearer <key>`, so keys never appear in URLs or logs.
 * Confirmed against the live REST API on 2026-11-24 (base URL https://api.massive.com; envelope
 * `status`, `request_id`, `results`, `resultsCount`; recorded under fixtures/massive). A plan problem
 * is HTTP 403 with `{"status":"NOT_AUTHORIZED", ...}`. Parsing accepts either a bare array or an
 * object with `results`.
 */
import type { Bar, Split } from '../corporate-actions.js';
import type { UpcomingRow } from '../calendar.js';
import { HttpClient } from '../http.js';
import type { PlanTier, Sourced } from '../provenance.js';
import { failure, type AdapterResult } from './result.js';

export interface MassiveConfig {
  apiKey: string;
  baseUrl?: string;
  planTier: PlanTier; // what the plan offers for this data, for provenance
  now: () => Date;
}

const DEFAULT_BASE = 'https://api.massive.com';

function rows(json: unknown): unknown[] | null {
  if (Array.isArray(json)) return json;
  if (json && typeof json === 'object' && Array.isArray((json as { results?: unknown }).results)) {
    return (json as { results: unknown[] }).results;
  }
  return null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** One Massive request with the shared auth, caching, failure classification and provenance. */
export async function massiveCall<T>(
  http: HttpClient,
  cfg: MassiveConfig,
  path: string,
  endpoint: string,
  cacheTtlMs: number,
  parse: (items: unknown[]) => { value: T; asOf: Date } | null,
): Promise<AdapterResult<T>> {
  const url = `${cfg.baseUrl ?? DEFAULT_BASE}${path}`;
  const res = await http.get(url, {
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
    cacheTtlMs,
  });
  if (!res.ok) return failure('Massive', res.kind, res.message);
  let json: unknown;
  try {
    json = JSON.parse(res.body);
  } catch {
    return failure('Massive', 'invalid-response', 'response was not JSON');
  }
  const items = rows(json);
  if (items === null) return failure('Massive', 'invalid-response', 'no results array');
  const parsed = parse(items);
  if (parsed === null)
    return failure('Massive', 'invalid-response', 'results did not match the expected fields');
  const data: Sourced<T> = {
    value: parsed.value,
    provenance: {
      source: 'massive',
      endpoint,
      asOf: parsed.asOf.toISOString(),
      fetchedAt: cfg.now().toISOString(),
      planTier: cfg.planTier,
    },
  };
  return { ok: true, data, latencyMs: res.latencyMs, fromCache: res.fromCache };
}

/** Upcoming market holidays and early closes. Cached for 12 hours: the calendar rarely changes. */
export function fetchMarketHolidays(
  http: HttpClient,
  cfg: MassiveConfig,
): Promise<AdapterResult<UpcomingRow[]>> {
  return massiveCall(
    http,
    cfg,
    '/v1/marketstatus/upcoming',
    '/v1/marketstatus/upcoming',
    12 * 3600_000,
    (items) => {
      const out: UpcomingRow[] = [];
      for (const it of items) {
        const r = it as Record<string, unknown>;
        if (
          typeof r['date'] !== 'string' ||
          typeof r['exchange'] !== 'string' ||
          typeof r['status'] !== 'string'
        )
          return null;
        const row: UpcomingRow = {
          date: r['date'],
          exchange: r['exchange'],
          name: String(r['name'] ?? ''),
          status: r['status'],
        };
        if (typeof r['open'] === 'string') row.open = r['open'];
        if (typeof r['close'] === 'string') row.close = r['close'];
        out.push(row);
      }
      return { value: out, asOf: cfg.now() };
    },
  );
}

function parseBars(items: unknown[], cfg: MassiveConfig): { value: Bar[]; asOf: Date } | null {
  const bars: Bar[] = [];
  for (const it of items) {
    const r = it as Record<string, unknown>;
    const t = num(r['t']);
    const o = num(r['o']);
    const h = num(r['h']);
    const l = num(r['l']);
    const c = num(r['c']);
    const v = num(r['v']);
    if (t === null || o === null || h === null || l === null || c === null || v === null)
      return null;
    if (h < l || c > h || c < l) return null; // an impossible bar is a bad print, not data
    const bar: Bar = { t, o, h, l, c, v };
    const vw = num(r['vw']);
    if (vw !== null) bar.vw = vw;
    bars.push(bar);
  }
  const last = bars.at(-1);
  return last ? { value: bars, asOf: new Date(last.t) } : { value: bars, asOf: cfg.now() };
}

/** Daily bars, split-adjusted by the vendor (`adjusted=true`). `asOf` is the last bar's timestamp. */
export function fetchDailyBars(
  http: HttpClient,
  cfg: MassiveConfig,
  ticker: string,
  from: string,
  to: string,
): Promise<AdapterResult<Bar[]>> {
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker)) throw new RangeError(`Bad ticker: ${ticker}`);
  const path = `/v2/aggs/ticker/${ticker}/range/1/day/${from}/${to}?adjusted=true&sort=asc`;
  return massiveCall(
    http,
    cfg,
    path,
    '/v2/aggs/ticker/{ticker}/range/1/day/{from}/{to}',
    3600_000,
    (items) => parseBars(items, cfg),
  );
}

/**
 * One day of 1-minute bars, including pre-market and after-hours bars (about 950 for a full day), each
 * with the vendor's own volume-weighted price. One request returns up to 50,000 bars, so a day never needs
 * paging. Minute volume covers roughly 93 to 97 percent of the daily volume (observed for SPY, 2026-11-16 to
 * 2026-11-20), so minute bars are not a full tape.
 */
export function fetchMinuteBars(
  http: HttpClient,
  cfg: MassiveConfig,
  ticker: string,
  date: string,
): Promise<AdapterResult<Bar[]>> {
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker)) throw new RangeError(`Bad ticker: ${ticker}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RangeError('date must be YYYY-MM-DD');
  const path = `/v2/aggs/ticker/${ticker}/range/1/minute/${date}/${date}?adjusted=true&sort=asc&limit=50000`;
  return massiveCall(
    http,
    cfg,
    path,
    '/v2/aggs/ticker/{ticker}/range/1/minute/{from}/{to}',
    3600_000,
    (items) => parseBars(items, cfg),
  );
}

export function fetchSplits(
  http: HttpClient,
  cfg: MassiveConfig,
  ticker: string,
): Promise<AdapterResult<Split[]>> {
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker)) throw new RangeError(`Bad ticker: ${ticker}`);
  return massiveCall(
    http,
    cfg,
    `/stocks/v1/splits?ticker=${ticker}&limit=100`,
    '/stocks/v1/splits',
    6 * 3600_000,
    (items) => {
      const out: Split[] = [];
      for (const it of items) {
        const r = it as Record<string, unknown>;
        const from = num(r['split_from']);
        const to = num(r['split_to']);
        if (
          typeof r['ticker'] !== 'string' ||
          typeof r['execution_date'] !== 'string' ||
          from === null ||
          to === null
        )
          return null;
        const split: Split = {
          ticker: r['ticker'],
          executionDate: r['execution_date'],
          splitFrom: from,
          splitTo: to,
          adjustmentType: String(r['adjustment_type'] ?? ''),
        };
        if (typeof r['id'] === 'string') split.vendorId = r['id'];
        const factor = num(r['historical_adjustment_factor']);
        if (factor !== null) split.historicalAdjustmentFactor = factor;
        out.push(split);
      }
      return { value: out, asOf: cfg.now() };
    },
  );
}

export interface TreasuryYieldDay {
  date: string; // YYYY-MM-DD
  y3m: number | null;
  y2y: number | null;
  y10y: number | null;
}

/** Daily Treasury yields (percent). Used to cross-check FRED's DGS10, T10Y3M and T10Y2Y. */
export function fetchTreasuryYields(
  http: HttpClient,
  cfg: MassiveConfig,
  from: string,
  to: string,
): Promise<AdapterResult<TreasuryYieldDay[]>> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))
    throw new RangeError('dates must be YYYY-MM-DD');
  const path = `/fed/v1/treasury-yields?date.gte=${from}&date.lte=${to}&limit=100&sort=date.asc`;
  return massiveCall(http, cfg, path, '/fed/v1/treasury-yields', 3600_000, (items) => {
    const out: TreasuryYieldDay[] = [];
    for (const it of items) {
      const r = it as Record<string, unknown>;
      if (typeof r['date'] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r['date'])) return null;
      out.push({
        date: r['date'],
        y3m: num(r['yield_3_month']),
        y2y: num(r['yield_2_year']),
        y10y: num(r['yield_10_year']),
      });
    }
    const last = out.at(-1);
    return { value: out, asOf: last ? new Date(`${last.date}T00:00:00Z`) : cfg.now() };
  });
}
