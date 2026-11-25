/**
 * Entry point for the alert digest (ADR 0032), run after the pre-market brief and the close recap. Reads
 * SUPABASE_URL, SUPABASE_SECRET_KEY and, when set, RESEND_API_KEY and BRIEF_EMAIL_TO; never logs them.
 */
import { resendSender } from './email.js';
import { runDigestJob } from './email-job.js';
import { supabaseEmailStore } from './push-store.js';
import { supabaseStore } from './store.js';

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

const url = need('SUPABASE_URL');
const key = need('SUPABASE_SECRET_KEY');
const run = await runDigestJob({
  store: { ...supabaseEmailStore(url, key), recordRun: supabaseStore(url, key).recordRun },
  send: resendSender(),
  now: () => new Date(),
});
console.log(
  `${run.job}: ${run.status}, rows ${run.rows_written ?? 0}, ${run.latency_ms} ms${run.error ? `, error: ${run.error}` : ''} details: ${JSON.stringify(run.details)}`,
);
if (run.status === 'error') process.exitCode = 1;
