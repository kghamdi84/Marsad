/**
 * Tauric (Tauric Research) adapter: a second quote source next to Massive (ADR 0041).
 *
 * Endpoint and fields: `POST /v1/quotes` on https://api.tauric.ai with `Authorization: Bearer <key>`,
 * body `{"instruments": ["security:AAPL", ...]}` (1 to 50 keys), answer `{object, next_cursor, data, errors}`
 * (schema `QuotesBatchResponse` in the public https://api.tauric.ai/openapi.json, read 2026-11-26). The
 * recorded answer is fixtures/tauric/quotes-2026-11-26.json.
 *
 * What the vendor does not give, and how Marsad treats it:
 * - Its delay for US stocks is not published, so the plan tier is `unknown` and the UI says "Delay not
 *   confirmed" (never "Live") until a measured live session proves otherwise.
 * - Its own `stale` flag and `price_age_seconds` are ignored: on 2026-11-26 an FX quote about 30 minutes
 *   old read `price_age_seconds: 5` and `stale: false` (the age at its last refresh, not at reading).
 *   Freshness is computed by Marsad from `price_time` and Marsad's own clock.
 * - Stock bid and ask are always null by design; they are not read.
 */
import { HttpClient } from '../http.js';
import type { FailureKind } from '../http.js';
import { evaluateFreshness, type Freshness } from '../provenance.js';
import type { MarketCalendar } from '../calendar.js';
import { normalizeTicker } from '../tickers.js';
import { failure, type AdapterResult } from './result.js';

export interface TauricConfig {
  apiKey: string;
  baseUrl?: string;
  now: () => Date;
}

const DEFAULT_BASE = 'https://api.tauric.ai';
export const TAURIC_ENDPOINT = 'POST /v1/quotes';
/** The vendor's limit on keys per batch request. */
export const TAURIC_MAX_BATCH = 50;

export type TauricQuoteKind = 'snapshot' | 'last_close' | 'exchange_quote';

/** One stock quote, as Marsad stores it. Prices are unadjusted, in the listing's currency (USD here). */
export interface TauricQuote {
  ticker: string;
  price: number;
  /** The vendor's time of the last trade (UTC ISO 8601), or null when it gave none. */
  priceTime: string | null;
  /** When the vendor last refreshed this quote, for the record only (it says nothing about delay). */
  vendorRefreshedAt: string | null;
  quoteKind: TauricQuoteKind;
  /** The trading session the price belongs to (YYYY-MM-DD, US Eastern). */
  sessionDate: string | null;
  previousClose: number | null;
  previousCloseDate: string | null;
  /** Change from the previous close as a fraction (0.0043 is +0.43%); the vendor sends percent. */
  change: number | null;
  /** The session's volume so far (shares), or null. */
  dayVolume: number | null;
  /** The vendor's market state word (for example "closed"), shown as given. */
  marketState: string | null;
}

export interface TauricQuotes {
  quotes: TauricQuote[];
  /** Keys the vendor answered without a usable quote, with its error code or Marsad's reason. */
  missing: { key: string; code: string }[];
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const QUOTE_KINDS: readonly TauricQuoteKind[] = ['snapshot', 'last_close', 'exchange_quote'];

function isoOrNull(v: unknown): string | null {
  const s = str(v);
  if (s === null) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/**
 * Reads a `QuotesBatchResponse`. Returns null when the envelope is not the documented shape. Only
 * `security:` keys are read; any other key, a ticker Marsad would not accept, or a quote without a price
 * is listed in `missing` with a reason, never guessed.
 */
export function parseTauricQuotes(json: unknown): TauricQuotes | null {
  if (typeof json !== 'object' || json === null) return null;
  const o = json as Record<string, unknown>;
  if (!Array.isArray(o['data']) || !Array.isArray(o['errors'])) return null;
  const quotes: TauricQuote[] = [];
  const missing: { key: string; code: string }[] = [];
  for (const raw of o['data'] as unknown[]) {
    const q = (raw ?? {}) as Record<string, unknown>;
    const key = str(q['key']) ?? '';
    if (!key.startsWith('security:')) {
      missing.push({ key, code: 'not-a-security' });
      continue;
    }
    const ticker = normalizeTicker(key.slice('security:'.length));
    const price = num(q['price']);
    const kind = q['quote_kind'] as TauricQuoteKind;
    if (ticker === null || price === null || price <= 0 || !QUOTE_KINDS.includes(kind)) {
      missing.push({ key, code: price === null ? 'no-price' : 'unreadable' });
      continue;
    }
    const prev = (q['previous_close'] ?? null) as Record<string, unknown> | null;
    const change = (q['change'] ?? null) as Record<string, unknown> | null;
    const day = (q['day'] ?? null) as Record<string, unknown> | null;
    const session = str(q['session_date']);
    const prevDate = prev ? str(prev['date']) : null;
    const pct = change ? num(change['percent']) : null;
    quotes.push({
      ticker,
      price,
      priceTime: isoOrNull(q['price_time']),
      vendorRefreshedAt: isoOrNull(q['refreshed_at']),
      quoteKind: kind,
      sessionDate: session !== null && DATE.test(session) ? session : null,
      previousClose: prev ? num(prev['value']) : null,
      previousCloseDate: prevDate !== null && DATE.test(prevDate) ? prevDate : null,
      change: pct === null ? null : pct / 100,
      dayVolume: day ? num(day['volume']) : null,
      marketState: str(q['market_state']),
    });
  }
  for (const raw of o['errors'] as unknown[]) {
    const e = (raw ?? {}) as Record<string, unknown>;
    const err = (e['error'] ?? {}) as Record<string, unknown>;
    missing.push({ key: str(e['key']) ?? '', code: str(err['code']) ?? 'error' });
  }
  return { quotes, missing };
}

const AUTH_CODES = new Set([
  'missing_api_key',
  'invalid_api_key',
  'api_key_inactive',
  'api_key_expired',
  'account_inactive',
]);

/**
 * Classifies a Tauric error (`{"error": {"code", "message", ...}}`). A spent daily quota is not retried:
 * its Retry-After can be hours, and the next scheduled run tries again anyway.
 */
export function classifyTauricFailure(
  status: number,
  bodyText: string,
): { kind: FailureKind; message: string } {
  let code = '';
  let message = bodyText.slice(0, 200);
  try {
    const err = (JSON.parse(bodyText) as { error?: { code?: unknown; message?: unknown } }).error;
    if (typeof err?.code === 'string') code = err.code;
    if (typeof err?.message === 'string') message = err.message;
  } catch {
    // Not JSON: keep the raw excerpt.
  }
  if (code === 'entitlement_required' || code === 'principal_not_permitted')
    return { kind: 'not-entitled', message };
  if (status === 401 || AUTH_CODES.has(code)) return { kind: 'auth-failed', message };
  if (code === 'quota_exhausted')
    return { kind: 'client-error', message: `daily quota exhausted: ${message}` };
  if (status === 429 || code === 'rate_limit_exceeded') return { kind: 'rate-limited', message };
  if (status === 404) return { kind: 'not-found', message };
  if (status >= 500 || code === 'temporarily_unavailable') return { kind: 'server-error', message };
  return { kind: 'client-error', message };
}

/** Latest quotes for up to 50 US tickers in one request (one data credit). */
export async function fetchTauricQuotes(
  http: HttpClient,
  cfg: TauricConfig,
  tickers: readonly string[],
): Promise<AdapterResult<TauricQuotes>> {
  if (tickers.length === 0 || tickers.length > TAURIC_MAX_BATCH)
    return failure('Tauric', 'client-error', `a batch takes 1 to ${TAURIC_MAX_BATCH} tickers`);
  const res = await http.post(
    `${cfg.baseUrl ?? DEFAULT_BASE}/v1/quotes`,
    JSON.stringify({ instruments: tickers.map((t) => `security:${t}`) }),
    {
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    },
  );
  if (!res.ok) return failure('Tauric', res.kind, res.message);
  let json: unknown;
  try {
    json = JSON.parse(res.body);
  } catch {
    return failure('Tauric', 'invalid-response', 'response was not JSON');
  }
  const parsed = parseTauricQuotes(json);
  if (parsed === null) {
    const keys =
      typeof json === 'object' && json !== null ? Object.keys(json).sort().join(', ') : typeof json;
    return failure('Tauric', 'invalid-response', `no data and errors arrays (fields: ${keys})`);
  }
  const times = parsed.quotes.flatMap((q) => (q.priceTime ? [q.priceTime] : [])).sort();
  const fetchedAt = cfg.now().toISOString();
  return {
    ok: true,
    data: {
      value: parsed,
      provenance: {
        source: 'tauric',
        endpoint: TAURIC_ENDPOINT,
        asOf: times.at(-1) ?? fetchedAt,
        fetchedAt,
        planTier: 'unknown',
      },
    },
    latencyMs: res.latencyMs,
    fromCache: res.fromCache,
  };
}

/** A session date's moment for end-of-day freshness: 16:00 UTC is inside that US Eastern date. */
const sessionMoment = (date: string): Date => new Date(`${date}T16:00:00Z`);

/**
 * Freshness of a stored Tauric quote, by Marsad's clock (never the vendor's own age or stale flag).
 * A `last_close` quote is end-of-day data. Any other quote has an unconfirmed delay (`unknown` tier),
 * so it reads "Delay not confirmed" while current and "Stale" once too old; it is never "Live".
 */
export function quoteFreshness(
  q: Pick<TauricQuote, 'quoteKind' | 'priceTime' | 'sessionDate'>,
  now: Date,
  calendar: MarketCalendar,
): Freshness {
  if (q.quoteKind === 'last_close') {
    const asOf = q.sessionDate
      ? sessionMoment(q.sessionDate)
      : q.priceTime
        ? new Date(q.priceTime)
        : null;
    return evaluateFreshness({ asOf, now, planTier: 'end-of-day', calendar });
  }
  const asOf = q.priceTime ? new Date(q.priceTime) : null;
  return evaluateFreshness({ asOf, now, planTier: 'unknown', calendar });
}
