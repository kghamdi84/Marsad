/**
 * Entry point for the weekly exports job (GitHub Actions, Sundays). Reads SUPABASE_URL and
 * SUPABASE_SECRET_KEY; never logs them. Makes no outside calls beyond Supabase: it reads tables and writes the private exports bucket.
 */
import { runExportsJob } from './exports-job.js';
import { supabaseStore } from './store.js';

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

const run = await runExportsJob({
  store: supabaseStore(need('SUPABASE_URL'), need('SUPABASE_SECRET_KEY')),
  now: () => new Date(),
});
console.log(
  `exports: ${run.status}, rows ${run.rows_written ?? 0}, ${run.latency_ms} ms${run.error ? `, error: ${run.error}` : ''}${run.details ? ` details: ${JSON.stringify(run.details)}` : ''}`,
);
if (run.status === 'error') process.exitCode = 1;
