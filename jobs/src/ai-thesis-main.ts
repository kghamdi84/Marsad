/**
 * Entry point for the thesis card drafts (ADR 0007, checklist 2.10). Reads SUPABASE_URL, SUPABASE_SECRET_KEY,
 * ANTHROPIC_API_KEY and, on a manual run, AI_THESIS_TICKERS (the workflow's "thesis_for" input); never logs a key.
 * Without the Anthropic key the run is recorded as skipped (not configured) and nothing is spent.
 */
import { anthropicFromEnv } from './anthropic.js';
import { supabaseAiStore } from './ai-store.js';
import { parseRequested, runAiThesisJob } from './ai-thesis-job.js';

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

const run = await runAiThesisJob({
  store: supabaseAiStore(need('SUPABASE_URL'), need('SUPABASE_SECRET_KEY')),
  client: anthropicFromEnv(),
  now: () => new Date(),
  requested: parseRequested(process.env['AI_THESIS_TICKERS']),
});
console.log(
  `ai-thesis-drafts: ${run.status}, rows ${run.rows_written ?? 0}, ${run.latency_ms} ms${run.error ? `, error: ${run.error}` : ''} details: ${JSON.stringify(run.details)}`,
);
if (run.status === 'error') process.exitCode = 1;
