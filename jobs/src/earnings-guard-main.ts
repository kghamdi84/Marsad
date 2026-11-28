/**
 * Entry point for the earnings guard (GitHub Actions, after the ticker summary step). Reads SUPABASE_URL and
 * SUPABASE_SECRET_KEY; never logs them. Makes no outside calls: it reads stored holdings, research, estimates and
 * bars.
 */
import { runEarningsGuardJob } from './earnings-guard-job.js';
import { supabaseEarningsGuardStore } from './earnings-guard-store.js';

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

const run = await runEarningsGuardJob({
  store: supabaseEarningsGuardStore(need('SUPABASE_URL'), need('SUPABASE_SECRET_KEY')),
  now: () => new Date(),
});
console.log(
  `earnings-guard: ${run.status}, rows ${run.rows_written ?? 0}, ${run.latency_ms} ms${run.error ? `, error: ${run.error}` : ''}${run.details ? ` details: ${JSON.stringify(run.details)}` : ''}`,
);
if (run.status === 'error') process.exitCode = 1;
