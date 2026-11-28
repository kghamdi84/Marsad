/**
 * CUSIP to ticker through OpenFIGI's mapping API (openfigi-1), so N-PORT holdings are matched by identifier, not by
 * company name. Pure: the job sends the batches and passes the parsed replies here. Without an API key OpenFIGI takes
 * at most 10 jobs per request and 25 requests a minute (checked 2026-11-28: HTTP 413 "Request may only contain 10
 * mapping jobs", header `ratelimit-policy: 25;w=60`); with a key, 100 jobs and 250 requests a minute (OpenFIGI API
 * documentation, Rate Limits). Real reply in fixtures/openfigi/mapping-cusip-us.json.
 */

export const OPENFIGI_VERSION = 'openfigi-1';
export const OPENFIGI_URL = 'https://api.openfigi.com/v3/mapping';
/** Jobs per request without an API key. */
export const OPENFIGI_BATCH = 10;
/** Jobs per request with an API key (header X-OPENFIGI-APIKEY); 250 requests a minute. */
export const OPENFIGI_BATCH_KEYED = 100;

export interface FigiJob {
  idType: 'ID_CUSIP';
  idValue: string;
  /** US composite listing only, so one ticker per security. */
  exchCode: 'US';
}

interface FigiItem {
  ticker?: unknown;
  exchCode?: unknown;
  marketSector?: unknown;
}

/** One reply per job, in job order: `{ data: [...] }` or `{ warning }` / `{ error }`. */
export type FigiReply = { data?: FigiItem[]; warning?: string; error?: string };

const CUSIP = /^[0-9A-Z]{9}$/;
const TICKER = /^[A-Z][A-Z0-9.-]{0,9}$/;

/** Distinct valid CUSIPs split into request bodies of at most `size` jobs. */
export function figiBatches(cusips: readonly string[], size = OPENFIGI_BATCH): FigiJob[][] {
  const unique = [...new Set(cusips.map((c) => c.trim().toUpperCase()))].filter((c) =>
    CUSIP.test(c),
  );
  const out: FigiJob[][] = [];
  for (let i = 0; i < unique.length; i += size)
    out.push(
      unique
        .slice(i, i + size)
        .map((c) => ({ idType: 'ID_CUSIP' as const, idValue: c, exchCode: 'US' as const })),
    );
  return out;
}

/**
 * The ticker of each job whose reply names exactly one US equity ticker. OpenFIGI writes share classes with a slash
 * (BRK/B); Marsad's bars use a dot (BRK.B), so the slash becomes a dot. No match, a warning, an error or two
 * different US tickers leave the CUSIP out: unmatched is better than a guess.
 */
export function parseFigiMapping(
  jobs: readonly FigiJob[],
  replies: readonly FigiReply[],
): Map<string, string> {
  if (replies.length !== jobs.length)
    throw new Error(`OpenFIGI returned ${replies.length} replies for ${jobs.length} jobs`);
  const out = new Map<string, string>();
  jobs.forEach((job, i) => {
    const items = (replies[i]?.data ?? []).filter(
      (d) => d.exchCode === 'US' && d.marketSector === 'Equity' && typeof d.ticker === 'string',
    );
    const tickers = new Set(
      items.map((d) => String(d.ticker).trim().toUpperCase().replace('/', '.')),
    );
    if (tickers.size !== 1) return;
    const t = [...tickers][0] as string;
    if (TICKER.test(t)) out.set(job.idValue, t);
  });
  return out;
}
