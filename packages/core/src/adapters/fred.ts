/**
 * FRED (St. Louis Fed) adapter. Needs a free API key, passed as the `api_key` query parameter (FRED
 * offers no header option), so the key is redacted from every stored endpoint string.
 *
 * Response shape follows the published API documentation: `{ observations: [{ date, value, ... }] }`
 * where a missing value is the string ".". Confirmed against the live API on 2026-11-24 and recorded
 * in fixtures/fred (DGS10 around Veterans Day, which shows the "." value).
 */
import { HttpClient } from '../http.js';
import type { Sourced } from '../provenance.js';
import { failure, type AdapterResult } from './result.js';

export interface FredConfig {
  apiKey: string;
  now: () => Date;
  baseUrl?: string;
}

export interface FredObservation {
  date: string; // YYYY-MM-DD
  value: number | null; // null where FRED publishes "."
}

/** The series Marsad uses, with what each feeds. */
export const FRED_SERIES = {
  VIXCLS: 'VIX daily close (cross-check of the vendor VIX)',
  VXVCLS: 'VIX3M daily close (3-month implied volatility), for the VIX term structure',
  SP500: 'S&P 500 index close (FRED keeps 10 years), for the regime label',
  T10Y3M: '10-year minus 3-month Treasury spread',
  T10Y2Y: '10-year minus 2-year Treasury spread',
  DGS10: '10-year Treasury yield (cross-check of Massive yields)',
  BAMLH0A0HYM2: 'High-yield option-adjusted spread',
  BAMLC0A0CM: 'Investment-grade option-adjusted spread',
  NFCI: 'Chicago Fed National Financial Conditions Index',
  ICSA: 'Initial jobless claims',
  SAHMREALTIME: 'Sahm rule recession indicator, real time',
  USEPUINDXD: 'Daily Economic Policy Uncertainty index',
  DCOILWTICO: 'WTI crude oil price',
  DTWEXBGS: 'Broad US dollar index',
} as const;

export type FredSeriesId = keyof typeof FRED_SERIES;

export function redactKey(url: string): string {
  return url.replace(/([?&]api_key=)[^&]*/g, '$1REDACTED');
}

export async function fetchFredSeries(
  http: HttpClient,
  cfg: FredConfig,
  series: FredSeriesId,
  observationStart: string,
): Promise<AdapterResult<FredObservation[]>> {
  if (!(series in FRED_SERIES)) throw new RangeError(`Unknown FRED series: ${series}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(observationStart))
    throw new RangeError('observationStart must be YYYY-MM-DD');
  const base = cfg.baseUrl ?? 'https://api.stlouisfed.org';
  const url = `${base}/fred/series/observations?series_id=${series}&observation_start=${observationStart}&file_type=json&api_key=${encodeURIComponent(cfg.apiKey)}`;
  const res = await http.get(url, { cacheTtlMs: 3600_000 });
  if (!res.ok) return failure('FRED', res.kind, redactKey(res.message));
  let json: unknown;
  try {
    json = JSON.parse(res.body);
  } catch {
    return failure('FRED', 'invalid-response', 'response was not JSON');
  }
  const obs = (json as { observations?: unknown }).observations;
  if (!Array.isArray(obs)) return failure('FRED', 'invalid-response', 'no observations array');
  const out: FredObservation[] = [];
  for (const o of obs) {
    const r = o as Record<string, unknown>;
    if (typeof r['date'] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r['date'])) {
      return failure('FRED', 'invalid-response', 'observation without a valid date');
    }
    const raw = r['value'];
    const value = raw === '.' || raw === undefined ? null : Number(raw);
    if (value !== null && !Number.isFinite(value))
      return failure('FRED', 'invalid-response', 'non-numeric value');
    out.push({ date: r['date'], value });
  }
  const lastWithValue = [...out].reverse().find((x) => x.value !== null);
  const data: Sourced<FredObservation[]> = {
    value: out,
    provenance: {
      source: 'fred',
      endpoint: redactKey(`/fred/series/observations?series_id=${series}`),
      asOf: new Date(`${lastWithValue?.date ?? observationStart}T00:00:00Z`).toISOString(),
      fetchedAt: cfg.now().toISOString(),
      planTier: 'end-of-day',
    },
  };
  return { ok: true, data, latencyMs: res.latencyMs, fromCache: res.fromCache };
}

/**
 * Release dates of every FRED release between two dates, including scheduled ones with no data yet
 * (`include_release_dates_with_no_data`), for the economic calendar (ADR 0013). Pages by 1,000 with `offset`: on
 * 2026-11-25 the next 10 weeks held 1,040 dates. Confirmed on that day (fixtures/fred/fred-release-dates-*).
 */
export async function fetchReleaseDates(
  http: HttpClient,
  cfg: FredConfig,
  from: string,
  to: string,
  maxPages = 5,
): Promise<AdapterResult<{ releaseId: number; releaseName: string; date: string }[]>> {
  const ok = /^\d{4}-\d{2}-\d{2}$/;
  if (!ok.test(from) || !ok.test(to)) throw new RangeError('dates must be YYYY-MM-DD');
  const base = cfg.baseUrl ?? 'https://api.stlouisfed.org';
  const out: { releaseId: number; releaseName: string; date: string }[] = [];
  let latencyMs = 0;
  for (let page = 0; page < maxPages; page++) {
    const url =
      `${base}/fred/releases/dates?realtime_start=${from}&realtime_end=${to}` +
      `&include_release_dates_with_no_data=true&sort_order=asc&limit=1000&offset=${page * 1000}` +
      `&file_type=json&api_key=${encodeURIComponent(cfg.apiKey)}`;
    const res = await http.get(url, { cacheTtlMs: 3600_000 });
    if (!res.ok) return failure('FRED', res.kind, redactKey(res.message));
    latencyMs += res.latencyMs;
    let json: unknown;
    try {
      json = JSON.parse(res.body);
    } catch {
      return failure('FRED', 'invalid-response', 'response was not JSON');
    }
    const body = json as { release_dates?: unknown; count?: unknown };
    if (!Array.isArray(body.release_dates))
      return failure('FRED', 'invalid-response', 'no release_dates array');
    for (const d of body.release_dates) {
      const r = d as Record<string, unknown>;
      if (
        typeof r['release_id'] !== 'number' ||
        typeof r['release_name'] !== 'string' ||
        typeof r['date'] !== 'string' ||
        !ok.test(r['date'])
      )
        return failure('FRED', 'invalid-response', 'release date without id, name or date');
      out.push({ releaseId: r['release_id'], releaseName: r['release_name'], date: r['date'] });
    }
    const count = typeof body.count === 'number' ? body.count : out.length;
    if (out.length >= count || body.release_dates.length < 1000)
      return {
        ok: true,
        data: {
          value: out,
          provenance: {
            source: 'fred',
            endpoint: '/fred/releases/dates',
            asOf: cfg.now().toISOString(),
            fetchedAt: cfg.now().toISOString(),
            planTier: 'end-of-day',
          },
        },
        latencyMs,
        fromCache: false,
      };
  }
  return failure('FRED', 'invalid-response', `more than ${maxPages} pages of release dates`);
}
