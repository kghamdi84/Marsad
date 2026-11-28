/**
 * Entry point for the nightly ticker summary (ADR 0050). Reads SUPABASE_URL and SUPABASE_SECRET_KEY; never logs
 * them. Calls only the database: every input is already stored by the bars, study-data, research and calendar jobs.
 */
import { runTickerSummaryJob } from './ticker-summary-job.js';
import { supabaseTickerSummaryStore } from './ticker-summary-store.js';

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

const run = await runTickerSummaryJob({
  store: supabaseTickerSummaryStore(need('SUPABASE_URL'), need('SUPABASE_SECRET_KEY')),
  now: () => new Date(),
});
console.log(
  `ticker-summary: ${run.status}, rows ${run.rows_written ?? 0}, ${run.latency_ms} ms${run.error ? `, error: ${run.error}` : ''} details: ${JSON.stringify(run.details)}`,
);
if (run.status === 'error') process.exitCode = 1;
