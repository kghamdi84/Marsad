/**
 * Entry point for the calendar job (run by GitHub Actions after the FRED job). Reads SUPABASE_URL,
 * SUPABASE_SECRET_KEY and FRED_API_KEY from the environment; never logs them.
 */
import { HttpClient, TokenBucket, TtlCache, type Clock, type FetchLike } from '@marsad/core';
import { runCalendarJob } from './calendar-job.js';
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

const run = await runCalendarJob({
  http: new HttpClient({
    fetch: fetchLike,
    clock,
    bucket: new TokenBucket(10, 2, clock),
    cache: new TtlCache<string>(),
    maxRetries: 3,
  }),
  fred: { apiKey: need('FRED_API_KEY'), now: () => new Date() },
  store: supabaseStore(need('SUPABASE_URL'), need('SUPABASE_SECRET_KEY')),
  now: () => new Date(),
});
console.log(
  `calendar-daily: ${run.status}, rows ${run.rows_written ?? 0}, ${run.latency_ms} ms${run.error ? `, error: ${run.error}` : ''}${run.details ? ` details: ${JSON.stringify(run.details)}` : ''}`,
);
if (run.status === 'error') process.exitCode = 1;
