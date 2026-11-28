/**
 * Security identity through OpenFIGI's mapping API (openfigi-2), so N-PORT holdings are matched by identifier, not
 * by company name, and keep their composite FIGI (identity by FIGI, not ticker). Pure: the job sends the batches and
 * passes the parsed replies here. Limits (OpenFIGI API documentation, Rate Limits; checked 2026-11-28): without an
 * API key 10 jobs per request and 25 requests a minute (HTTP 413 "Request may only contain 10 mapping jobs", header
 * `ratelimit-policy: 25;w=60`); with a key (header X-OPENFIGI-APIKEY) 100 jobs and 250 requests a minute. A 429
 * carries `retry-after` in seconds; 500 and 503 are retried with exponential backoff, as the documentation advises.
 * Real reply in fixtures/openfigi/mapping-cusip-isin-equity.json.
 */

export const OPENFIGI_VERSION = 'openfigi-2';
export const OPENFIGI_URL = 'https://api.openfigi.com/v3/mapping';
/** Jobs per request without an API key. */
export const OPENFIGI_BATCH = 10;
/** Jobs per request with an API key (header X-OPENFIGI-APIKEY); 250 requests a minute. */
export const OPENFIGI_BATCH_KEYED = 100;

export type FigiIdType = 'ID_CUSIP' | 'ID_ISIN';

export interface FigiJob {
  idType: FigiIdType;
  idValue: string;
  /** US composite listing only, so one ticker per security. */
  exchCode: 'US';
  /** Equity only, filtered by OpenFIGI before it answers. */
  marketSecDes: 'Equity';
}

interface FigiItem {
  ticker?: unknown;
  exchCode?: unknown;
  marketSector?: unknown;
  compositeFIGI?: unknown;
}

/** One reply per job, in job order: `{ data: [...] }` or `{ warning }` / `{ error }`. */
export type FigiReply = { data?: FigiItem[]; warning?: string; error?: string };

/** The US ticker (share classes with a dot) and the composite FIGI of one security. */
export interface FigiMatch {
  ticker: string;
  figi: string | null;
}

const FORMAT: Record<FigiIdType, RegExp> = {
  ID_CUSIP: /^[0-9A-Z]{9}$/,
  ID_ISIN: /^[A-Z]{2}[0-9A-Z]{9}[0-9]$/,
};
const TICKER = /^[A-Z][A-Z0-9.-]{0,9}$/;
const FIGI = /^BBG[0-9A-Z]{9}$/;

/** Distinct well-formed identifiers split into request bodies of at most `size` jobs. */
export function figiBatches(
  ids: readonly string[],
  size = OPENFIGI_BATCH,
  idType: FigiIdType = 'ID_CUSIP',
): FigiJob[][] {
  const unique = [...new Set(ids.map((c) => c.trim().toUpperCase()))].filter((c) =>
    FORMAT[idType].test(c),
  );
  const out: FigiJob[][] = [];
  for (let i = 0; i < unique.length; i += size)
    out.push(
      unique.slice(i, i + size).map((c) => ({
        idType,
        idValue: c,
        exchCode: 'US' as const,
        marketSecDes: 'Equity' as const,
      })),
    );
  return out;
}

/**
 * The match of each job whose reply names exactly one US equity ticker. OpenFIGI writes share classes with a slash
 * (BRK/B); Marsad's bars use a dot (BRK.B), so the slash becomes a dot. No match, a warning, an error or two different
 * US tickers leave the identifier out: unmatched is better than a guess. The FIGI is kept only when every listing of
 * that ticker names the same composite FIGI.
 */
export function parseFigiMapping(
  jobs: readonly FigiJob[],
  replies: readonly FigiReply[],
): Map<string, FigiMatch> {
  if (replies.length !== jobs.length)
    throw new Error(`OpenFIGI returned ${replies.length} replies for ${jobs.length} jobs`);
  const out = new Map<string, FigiMatch>();
  jobs.forEach((job, i) => {
    const items = (replies[i]?.data ?? []).filter(
      (d) => d.exchCode === 'US' && d.marketSector === 'Equity' && typeof d.ticker === 'string',
    );
    const tickers = new Set(
      items.map((d) => String(d.ticker).trim().toUpperCase().replace('/', '.')),
    );
    if (tickers.size !== 1) return;
    const ticker = [...tickers][0] as string;
    if (!TICKER.test(ticker)) return;
    const figis = new Set(
      items.map((d) => (typeof d.compositeFIGI === 'string' ? d.compositeFIGI : '')),
    );
    const figi = figis.size === 1 ? ([...figis][0] as string) : '';
    out.set(job.idValue, { ticker, figi: FIGI.test(figi) ? figi : null });
  });
  return out;
}

/**
 * How long to wait before retrying a failed mapping request, or null to stop. 429: the `retry-after` seconds
 * (60 when absent or unreadable, at most 120), once. 500 and 503: 2, 4, then 8 seconds. Anything else: no retry.
 */
export function figiRetryDelayMs(
  status: number,
  retryAfter: string | null,
  attempt: number,
): number | null {
  if (status === 429) {
    if (attempt > 0) return null;
    const s = Number(retryAfter);
    return (Number.isFinite(s) && s > 0 ? Math.min(s, 120) : 60) * 1000 + 500;
  }
  if (status === 500 || status === 503) return attempt < 3 ? 2000 * 2 ** attempt : null;
  return null;
}
