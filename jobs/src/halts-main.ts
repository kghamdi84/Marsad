/**
 * Entry point for the halts job (run by GitHub Actions every 5 minutes around US trading hours).
 * Reads SUPABASE_URL and SUPABASE_SECRET_KEY from the environment; never logs them.
 */
import { HttpClient, TokenBucket, TtlCache, type Clock, type FetchLike } from '@marsad/core';
import { runHaltsJob } from './halts-job.js';
import { supabaseStore } from './store.js';

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

const clock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};
const fetchLike: FetchLike = (url, init) =>
  fetch(url, init?.headers ? { headers: init.headers } : undefined);

const run = await runHaltsJob({
  // One request per run; the bucket enforces the agreed floor of one request per 30 seconds if ever looped.
  http: new HttpClient({
    fetch: fetchLike,
    clock,
    bucket: new TokenBucket(1, 1 / 30, clock),
    cache: new TtlCache<string>(),
    maxRetries: 2,
    baseDelayMs: 5000,
  }),
  cfg: { now: () => new Date() },
  store: supabaseStore(need('SUPABASE_URL'), need('SUPABASE_SECRET_KEY')),
  now: () => new Date(),
});

console.log(
  `nasdaq-halts: ${run.status}, rows ${run.rows_written ?? 0}, ${run.latency_ms} ms${run.error ? `, error: ${run.error}` : ''}${run.status === 'ok' ? ` details: ${JSON.stringify(run.details)}` : ''}`,
);
if (run.status === 'error') process.exitCode = 1;
