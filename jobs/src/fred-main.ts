/**
 * Entry point for the FRED job (run by GitHub Actions). Reads SUPABASE_URL, SUPABASE_SECRET_KEY and
 * FRED_API_KEY from the environment; never logs them.
 */
import { HttpClient, TokenBucket, TtlCache, type Clock, type FetchLike } from '@marsad/core';
import { runFredJob } from './fred-job.js';
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

const run = await runFredJob({
  http: new HttpClient({
    fetch: fetchLike,
    clock,
    bucket: new TokenBucket(10, 2, clock), // well under FRED's 120 requests a minute
    cache: new TtlCache<string>(),
    maxRetries: 3,
  }),
  apiKey: need('FRED_API_KEY'),
  store: supabaseStore(need('SUPABASE_URL'), need('SUPABASE_SECRET_KEY')),
  now: () => new Date(),
  logSample: (series, newest) =>
    console.log(`sample ${series}: ${newest.map((o) => `${o.date}=${o.value}`).join(' ')}`),
});

console.log(
  `fred-daily: ${run.status}, rows ${run.rows_written ?? 0}, ${run.latency_ms} ms${run.error ? `, error: ${run.error}` : ''}`,
);
if (run.status === 'error') process.exitCode = 1;
