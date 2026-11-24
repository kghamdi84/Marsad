/**
 * Entry point for the Massive jobs (run by GitHub Actions): `reference`, `reconcile`, `bars`, `news`, `study` or `sections`.
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
import { runBarsJob } from './bars-job.js';
import { runNewsJob } from './news-job.js';
import { runSectionsJob } from './sections-job.js';
import { runStudyDataJob } from './study-data-job.js';
import { runMassiveReferenceJob } from './massive-reference-job.js';
import { runReconcileJob } from './reconcile-job.js';
import { supabaseStore } from './store.js';

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

const which = process.argv[2];
const MODES = ['reference', 'reconcile', 'bars', 'news', 'study', 'sections'] as const;
type Mode = (typeof MODES)[number];
if (!MODES.includes(which as Mode)) throw new Error(`usage: massive-main.ts ${MODES.join('|')}`);

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

const jobs = {
  reference: () => runMassiveReferenceJob({ http, cfg, store, now }),
  reconcile: () => runReconcileJob({ http, cfg, store, now }),
  bars: () => runBarsJob({ http, cfg, store, now }),
  news: () => runNewsJob({ http, cfg, store, now }),
  study: () => runStudyDataJob({ http, cfg, store, now }),
  sections: () => runSectionsJob({ http, cfg, store, now }),
} satisfies Record<Mode, () => Promise<unknown>>;
const run = await jobs[which as Mode]();
console.log(
  `${run.job}: ${run.status}, rows ${run.rows_written ?? 0}, ${run.latency_ms} ms${run.error ? `, error: ${run.error}` : ''}${run.status === 'ok' ? ` details: ${JSON.stringify(run.details)}` : ''}`,
);
if (run.status === 'error') process.exitCode = 1;
