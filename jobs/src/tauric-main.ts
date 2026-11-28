/**
 * Entry point for the Tauric jobs (run by GitHub Actions): `quotes` (every 5 minutes in the session) or
 * `reconcile` (nightly, against Massive). Reads TAURIC_API_KEY, SUPABASE_URL and SUPABASE_SECRET_KEY from the
 * environment; never logs them. ADR 0041.
 */
import {
  HttpClient,
  TokenBucket,
  classifyTauricFailure,
  type Clock,
  type FetchLike,
  type TauricConfig,
} from '@marsad/core';
import { runTauricQuotesJob, runTauricReconcileJob } from './tauric-job.js';
import { runTauricResearchJob } from './tauric-research-job.js';
import { supabaseTauricResearchStore, supabaseTauricStore } from './tauric-store.js';

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

const which = process.argv[2];
if (which !== 'quotes' && which !== 'reconcile' && which !== 'research')
  throw new Error('usage: tauric-main.ts quotes|reconcile|research');

const clock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};
const fetchLike: FetchLike = (url, init) => fetch(url, init);

// One batch call per run; the vendor allows 60 a minute and 3,000 data credits a day. A run uses one credit, so
// the 5-minute schedule spends about 110 a day at most (13:00 to 21:59 UTC) plus one for the nightly check.
const http = new HttpClient({
  fetch: fetchLike,
  clock,
  bucket: new TokenBucket(1, 1, clock),
  classify: classifyTauricFailure,
  maxRetries: 2,
  baseDelayMs: 2000,
  maxDelayMs: 20_000,
});
const cfg: TauricConfig = { apiKey: need('TAURIC_API_KEY'), now: () => new Date() };
const now = () => new Date();

// The research job (ADR 0047) makes up to 300 single-ticker calls at one a second, inside the 60-a-minute limit.
const run =
  which === 'research'
    ? await runTauricResearchJob({
        http,
        cfg,
        store: supabaseTauricResearchStore(need('SUPABASE_URL'), need('SUPABASE_SECRET_KEY')),
        now,
      })
    : which === 'quotes'
      ? await runTauricQuotesJob({
          http,
          cfg,
          store: supabaseTauricStore(need('SUPABASE_URL'), need('SUPABASE_SECRET_KEY')),
          now,
        })
      : await runTauricReconcileJob({
          http,
          cfg,
          store: supabaseTauricStore(need('SUPABASE_URL'), need('SUPABASE_SECRET_KEY')),
          now,
        });
console.log(
  `${run.job}: ${run.status}, rows ${run.rows_written ?? 0}, ${run.latency_ms} ms${run.error ? `, error: ${run.error}` : ''} details: ${JSON.stringify(run.details)}`,
);
if (run.status === 'error') process.exitCode = 1;
