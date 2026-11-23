/**
 * Massive (formerly Polygon.io) adapter. Endpoints and fields were confirmed with the Massive
 * connector's endpoint search and recorded in fixtures/massive on 2026-11-23.
 *
 * Authentication: `Authorization: Bearer <key>`, so keys never appear in URLs or logs.
 * Unconfirmed against the live REST API (no key was available when this was written): the base URL
 * and the JSON envelope (`status`, `request_id`, `next_url`). Parsing accepts either a bare array or
 * an object with `results`.
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

async function call<T>(
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
  return call(
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
  return call(
    http,
    cfg,
    path,
    '/v2/aggs/ticker/{ticker}/range/1/day/{from}/{to}',
    3600_000,
    (items) => {
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
        bars.push({ t, o, h, l, c, v });
      }
      const last = bars.at(-1);
      return last ? { value: bars, asOf: new Date(last.t) } : { value: bars, asOf: cfg.now() };
    },
  );
}

export function fetchSplits(
  http: HttpClient,
  cfg: MassiveConfig,
  ticker: string,
): Promise<AdapterResult<Split[]>> {
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker)) throw new RangeError(`Bad ticker: ${ticker}`);
  return call(
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
        out.push({
          ticker: r['ticker'],
          executionDate: r['execution_date'],
          splitFrom: from,
          splitTo: to,
          adjustmentType: String(r['adjustment_type'] ?? ''),
        });
      }
      return { value: out, asOf: cfg.now() };
    },
  );
}
