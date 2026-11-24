/**
 * Entry point for the SEC jobs (run by GitHub Actions): `filings` (default), `facts` or `insiders`. Reads SEC_USER_AGENT, SUPABASE_URL and
 * SUPABASE_SECRET_KEY from the environment; never logs them.
 */
import { HttpClient, TokenBucket, TtlCache, type Clock, type FetchLike } from '@marsad/core';
import { runFactsJob } from './facts-job.js';
import { runInsidersJob } from './insiders-job.js';
import { runSecJob } from './sec-job.js';
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

const MODES = ['filings', 'facts', 'insiders'] as const;
type Mode = (typeof MODES)[number];
const which = (process.argv[2] ?? 'filings') as Mode;
if (!MODES.includes(which)) throw new Error(`usage: sec-main.ts ${MODES.join('|')}`);

const deps = {
  // The SEC allows 10 requests a second; stay at 2 with a small burst.
  http: new HttpClient({
    fetch: fetchLike,
    clock,
    bucket: new TokenBucket(4, 2, clock),
    cache: new TtlCache<string>(),
    maxRetries: 3,
    baseDelayMs: 2000,
  }),
  cfg: { userAgent: need('SEC_USER_AGENT'), now: () => new Date() },
  store: supabaseStore(need('SUPABASE_URL'), need('SUPABASE_SECRET_KEY')),
  now: () => new Date(),
};
const run = await { filings: runSecJob, facts: runFactsJob, insiders: runInsidersJob }[which](deps);

console.log(
  `${run.job}: ${run.status}, rows ${run.rows_written ?? 0}, ${run.latency_ms} ms${run.error ? `, error: ${run.error}` : ''}${run.status === 'ok' ? ` details: ${JSON.stringify(run.details)}` : ''}`,
);
if (run.status === 'error') process.exitCode = 1;
