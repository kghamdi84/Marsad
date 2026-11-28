/**
 * Entry point for the daily filing summaries (ADR 0007, checklist 2.9). Reads SUPABASE_URL, SUPABASE_SECRET_KEY
 * and ANTHROPIC_API_KEY; never logs them. Without the Anthropic key the run is recorded as skipped (not
 * configured) and nothing is spent.
 */
import { anthropicFromEnv } from './anthropic.js';
import { supabaseAiStore } from './ai-store.js';
import { runAiSummariesJob } from './ai-summaries-job.js';

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

const run = await runAiSummariesJob({
  store: supabaseAiStore(need('SUPABASE_URL'), need('SUPABASE_SECRET_KEY')),
  client: anthropicFromEnv(),
  now: () => new Date(),
});
console.log(
  `ai-summaries: ${run.status}, rows ${run.rows_written ?? 0}, ${run.latency_ms} ms${run.error ? `, error: ${run.error}` : ''} details: ${JSON.stringify(run.details)}`,
);
if (run.status === 'error') process.exitCode = 1;
