/**
 * Entry point for the backtest runner (GitHub Actions, weekly and by hand). Reads SUPABASE_URL and
 * SUPABASE_SECRET_KEY; never logs them. Makes no outside calls: it reads stored bars and regime labels.
 */
import { runBacktestJob } from './backtest-job.js';
import { supabaseStore } from './store.js';

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

const run = await runBacktestJob({
  store: supabaseStore(need('SUPABASE_URL'), need('SUPABASE_SECRET_KEY')),
  now: () => new Date(),
});
console.log(
  `backtest-lab: ${run.status}, rules ${run.rows_written ?? 0}, ${run.latency_ms} ms${run.error ? `, error: ${run.error}` : ''}${run.details ? ` details: ${JSON.stringify(run.details)}` : ''}`,
);
if (run.status === 'error') process.exitCode = 1;
