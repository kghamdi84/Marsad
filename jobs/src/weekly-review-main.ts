/**
 * Entry point for the weekly review (GitHub Actions, Sundays). Reads SUPABASE_URL and SUPABASE_SECRET_KEY; emails
 * through Resend when RESEND_API_KEY and BRIEF_EMAIL_TO are set. Never logs a key or the address.
 */
import { resendSender } from './email.js';
import { supabaseStore } from './store.js';
import { runWeeklyReviewJob } from './weekly-review-job.js';

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

const sendEmail = resendSender();
const run = await runWeeklyReviewJob({
  store: supabaseStore(need('SUPABASE_URL'), need('SUPABASE_SECRET_KEY')),
  now: () => new Date(),
  ...(sendEmail ? { sendEmail } : {}),
});
console.log(
  `weekly-review: ${run.status}, ${run.latency_ms} ms${run.error ? `, error: ${run.error}` : ''}${run.details ? ` details: ${JSON.stringify(run.details)}` : ''}`,
);
if (run.status === 'error') process.exitCode = 1;
