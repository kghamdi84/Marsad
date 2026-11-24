/**
 * Entry point for the Massive jobs (run by GitHub Actions): `reference` or `reconcile`.
 * Reads MASSIVE_API_KEY, SUPABASE_URL and SUPABASE_SECRET_KEY from the environment; never logs them.
 */
import {
  HttpClient,
  TokenBucket,
  TtlCache,
  type Clock,
  type FetchLike,
  type MassiveConfig,
} from '@marsad/core';
import { runMassiveReferenceJob } from './massive-reference-job.js';
import { runReconcileJob } from './reconcile-job.js';
import { supabaseStore } from './store.js';

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

const which = process.argv[2];
if (which !== 'reference' && which !== 'reconcile')
  throw new Error('usage: massive-main.ts reference|reconcile');

const clock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};
const fetchLike: FetchLike = (url, init) =>
  fetch(url, init?.headers ? { headers: init.headers } : undefined);

// The free plan allows about 5 calls a minute: a bucket of 5 refilling at 5 per minute stays inside it.
const http = new HttpClient({
  fetch: fetchLike,
  clock,
  bucket: new TokenBucket(5, 5 / 60, clock),
  cache: new TtlCache<string>(),
  maxRetries: 3,
  baseDelayMs: 2000,
});
const cfg: MassiveConfig = {
  apiKey: need('MASSIVE_API_KEY'),
  planTier: 'end-of-day',
  now: () => new Date(),
};
const store = supabaseStore(need('SUPABASE_URL'), need('SUPABASE_SECRET_KEY'));
const now = () => new Date();

const run =
  which === 'reference'
    ? await runMassiveReferenceJob({ http, cfg, store, now })
    : await runReconcileJob({ http, cfg, store, now });
console.log(
  `${run.job}: ${run.status}, rows ${run.rows_written ?? 0}, ${run.latency_ms} ms${run.error ? `, error: ${run.error}` : ''}${run.status === 'ok' ? ` details: ${JSON.stringify(run.details)}` : ''}`,
);
if (run.status === 'error') process.exitCode = 1;
