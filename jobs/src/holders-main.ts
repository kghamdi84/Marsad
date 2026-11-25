/**
 * Entry point for the 13F holders job (ADR 0037). Reads SEC_USER_AGENT, SUPABASE_URL and SUPABASE_SECRET_KEY;
 * never logs them. Downloads the newest SEC Form 13F data set (about 100 MB) only when it is new.
 */
import { HttpClient, TokenBucket, TtlCache, type Clock, type FetchLike } from '@marsad/core';
import { runHoldersJob } from './holders-job.js';
import { secThirteenFSource, supabaseHoldersStore } from './holders-io.js';

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

const run = await runHoldersJob({
  http: new HttpClient({
    fetch: fetchLike,
    clock,
    bucket: new TokenBucket(4, 2, clock),
    cache: new TtlCache<string>(),
    maxRetries: 3,
    baseDelayMs: 2000,
  }),
  sec: { userAgent: ua, now: () => new Date() },
  source: secThirteenFSource(ua),
  store: supabaseHoldersStore(need('SUPABASE_URL'), need('SUPABASE_SECRET_KEY')),
  now: () => new Date(),
});
console.log(
  `sec-13f-holders: ${run.status}, rows ${run.rows_written ?? 0}, ${run.latency_ms} ms${run.error ? `, error: ${run.error}` : ''} details: ${JSON.stringify(run.details)}`,
);
if (run.status === 'error') process.exitCode = 1;
