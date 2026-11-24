/**
 * Entry point for the heartbeat (run by GitHub Actions every 15 minutes around US trading hours, and every
 * 3 hours otherwise). Reads SUPABASE_URL and SUPABASE_SECRET_KEY from the environment; never logs them.
 */
import { runHealthJob } from './health-job.js';
import { supabaseStore } from './store.js';

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

const run = await runHealthJob({
  store: supabaseStore(need('SUPABASE_URL'), need('SUPABASE_SECRET_KEY')),
  now: () => new Date(),
});

console.log(
  `health-check: ${run.status}, alerts ${run.rows_written ?? 0}, ${run.latency_ms} ms${run.error ? `, error: ${run.error}` : ''}${run.status === 'ok' ? ` details: ${JSON.stringify(run.details)}` : ''}`,
);
if (run.status === 'error') process.exitCode = 1;
