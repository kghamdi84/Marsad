/**
 * Entry point for the ETF holdings job (ADR 0038). Reads SEC_USER_AGENT, SUPABASE_URL and SUPABASE_SECRET_KEY;
 * never logs them. Downloads each covered fund's newest N-PORT report once.
 */
import { HttpClient, TokenBucket, TtlCache, type Clock, type FetchLike } from '@marsad/core';
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
});
console.log(
  `sec-etf-holdings: ${run.status}, rows ${run.rows_written ?? 0}, ${run.latency_ms} ms${run.error ? `, error: ${run.error}` : ''} details: ${JSON.stringify(run.details)}`,
);
if (run.status === 'error') process.exitCode = 1;
