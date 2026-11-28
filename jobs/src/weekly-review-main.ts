/**
 * Entry point for the weekly review (GitHub Actions, Sundays). Reads SUPABASE_URL and SUPABASE_SECRET_KEY; emails
 * through Resend when RESEND_API_KEY and BRIEF_EMAIL_TO are set; adds Claude Opus prose when ANTHROPIC_API_KEY is
 * set (ADR 0007). Never logs a key or the address.
 */
import { anthropicFromEnv } from './anthropic.js';
import { supabaseAiStore } from './ai-store.js';
import { resendSender } from './email.js';
import { supabaseStore } from './store.js';
import { runWeeklyReviewJob } from './weekly-review-job.js';

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

const sendEmail = resendSender();
const url = need('SUPABASE_URL');
const key = need('SUPABASE_SECRET_KEY');
const run = await runWeeklyReviewJob({
  store: supabaseStore(url, key),
  now: () => new Date(),
  // Opus prose when ANTHROPIC_API_KEY is set and spend is under the caps; template-only otherwise.
  ai: { client: anthropicFromEnv(), store: supabaseAiStore(url, key) },
  ...(sendEmail ? { sendEmail } : {}),
});
console.log(
  `weekly-review: ${run.status}, ${run.latency_ms} ms${run.error ? `, error: ${run.error}` : ''}${run.details ? ` details: ${JSON.stringify(run.details)}` : ''}`,
);
if (run.status === 'error') process.exitCode = 1;
