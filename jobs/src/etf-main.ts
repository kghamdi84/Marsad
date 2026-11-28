/**
 * Entry point for the ETF holdings job (ADR 0038). Reads SEC_USER_AGENT, SUPABASE_URL and SUPABASE_SECRET_KEY;
 * never logs them. Downloads each covered fund's newest N-PORT report once.
 */
import {
  HttpClient,
  OPENFIGI_BATCH,
  OPENFIGI_BATCH_KEYED,
  OPENFIGI_URL,
  TokenBucket,
  TtlCache,
  figiBatches,
  figiRetryDelayMs,
  parseFigiMapping,
  type Clock,
  type FetchLike,
  type FigiMatch,
  type FigiReply,
} from '@marsad/core';
import { runEtfJob } from './etf-job.js';
import { supabaseEtfStore } from './etf-io.js';

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}
const clock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};
const fetchLike: FetchLike = (url, init) =>
  fetch(url, init?.headers ? { headers: init.headers } : undefined);
const ua = need('SEC_USER_AGENT');

/**
 * CUSIPs and ISINs to tickers and composite FIGIs through OpenFIGI (openfigi-2). With OPENFIGI_API_KEY (sent as
 * X-OPENFIGI-APIKEY, never logged): 100 jobs a request, one request every 0.3 s (limit 250 a minute). Without it:
 * 10 jobs, one every 2.6 s (limit 25 a minute). A 429 waits for retry-after once; 500 and 503 back off 2, 4 and 8
 * seconds; any other failure throws and the job falls back to name matching.
 */
const figiKey = process.env['OPENFIGI_API_KEY']?.trim() || null;
async function figi(ids: {
  cusips: readonly string[];
  isins: readonly string[];
}): Promise<Map<string, FigiMatch>> {
  const out = new Map<string, FigiMatch>();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (figiKey) headers['X-OPENFIGI-APIKEY'] = figiKey;
  const size = figiKey ? OPENFIGI_BATCH_KEYED : OPENFIGI_BATCH;
  const batches = [
    ...figiBatches(ids.cusips, size, 'ID_CUSIP'),
    ...figiBatches(ids.isins, size, 'ID_ISIN'),
  ];
  for (const [i, jobs] of batches.entries()) {
    if (i > 0) await clock.sleep(figiKey ? 300 : 2600);
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(OPENFIGI_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(jobs),
      });
      if (res.ok) {
        for (const [id, m] of parseFigiMapping(jobs, (await res.json()) as FigiReply[]))
          out.set(id, m);
        break;
      }
      const wait = figiRetryDelayMs(res.status, res.headers.get('retry-after'), attempt);
      if (wait === null)
        throw new Error(`OpenFIGI answered ${res.status}${figiKey ? ' (with key)' : ''}`);
      await clock.sleep(wait);
    }
  }
  return out;
}

const run = await runEtfJob({
  http: new HttpClient({
    fetch: fetchLike,
    clock,
    bucket: new TokenBucket(4, 2, clock),
    cache: new TtlCache<string>(),
    maxRetries: 3,
    baseDelayMs: 2000,
  }),
  sec: { userAgent: ua, now: () => new Date() },
  store: supabaseEtfStore(need('SUPABASE_URL'), need('SUPABASE_SECRET_KEY')),
  now: () => new Date(),
  figi,
});
console.log(
  `sec-etf-holdings: ${run.status}, rows ${run.rows_written ?? 0}, ${run.latency_ms} ms${run.error ? `, error: ${run.error}` : ''} details: ${JSON.stringify(run.details)}`,
);
if (run.status === 'error') process.exitCode = 1;
