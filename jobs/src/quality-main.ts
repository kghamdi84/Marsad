/**
 * Entry point for the weekly quality-at-a-discount screen (ADR 0035). Reads SEC_USER_AGENT, SUPABASE_URL and
 * SUPABASE_SECRET_KEY; never logs them. Calls only the SEC (frames and the ticker list) and the database.
 */
import { HttpClient, TokenBucket, TtlCache, type Clock, type FetchLike } from '@marsad/core';
import { runQualityJob } from './quality-job.js';
import { supabaseQualityStore } from './quality-store.js';

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

const run = await runQualityJob({
  // The SEC allows 10 requests a second; stay at 2 with a small burst.
  http: new HttpClient({
    fetch: fetchLike,
    clock,
    bucket: new TokenBucket(4, 2, clock),
    cache: new TtlCache<string>(),
    maxRetries: 3,
    baseDelayMs: 2000,
  }),
  sec: { userAgent: need('SEC_USER_AGENT'), now: () => new Date() },
  store: supabaseQualityStore(need('SUPABASE_URL'), need('SUPABASE_SECRET_KEY')),
  now: () => new Date(),
});
console.log(
  `quality-screen: ${run.status}, rows ${run.rows_written ?? 0}, ${run.latency_ms} ms${run.error ? `, error: ${run.error}` : ''} details: ${JSON.stringify(run.details)}`,
);
if (run.status === 'error') process.exitCode = 1;
