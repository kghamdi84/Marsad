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
  parseFigiMapping,
  type Clock,
  type FetchLike,
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
 * CUSIP to ticker through OpenFIGI. With OPENFIGI_API_KEY (sent as X-OPENFIGI-APIKEY, never logged): 100 jobs a
 * request, 250 requests a minute, so one request every 0.3 s. Without it: 10 jobs, 25 a minute, one every 2.6 s.
 * A 429 waits a minute once; any other failure throws and the job falls back to name matching.
 */
const figiKey = process.env['OPENFIGI_API_KEY']?.trim() || null;
async function figi(cusips: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (figiKey) headers['X-OPENFIGI-APIKEY'] = figiKey;
  const post = (jobs: unknown) =>
    fetch(OPENFIGI_URL, { method: 'POST', headers, body: JSON.stringify(jobs) });
  const size = figiKey ? OPENFIGI_BATCH_KEYED : OPENFIGI_BATCH;
  for (const [i, jobs] of figiBatches(cusips, size).entries()) {
    if (i > 0) await clock.sleep(figiKey ? 300 : 2600);
    let res = await post(jobs);
    if (res.status === 429) {
      await clock.sleep(61_000);
      res = await post(jobs);
    }
    if (!res.ok) throw new Error(`OpenFIGI answered ${res.status}${figiKey ? ' (with key)' : ''}`);
    for (const [c, t] of parseFigiMapping(jobs, (await res.json()) as FigiReply[])) out.set(c, t);
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
