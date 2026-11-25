/**
 * Entry point for the brief job: `pre-market` or `close-recap` (run by GitHub Actions). Reads SUPABASE_URL and
 * SUPABASE_SECRET_KEY; when RESEND_API_KEY and BRIEF_EMAIL_TO are set, emails the brief through Resend's API.
 * Never logs a key or the address.
 */
import type { BriefKind } from '@marsad/core';
import { runBriefJob } from './brief-job.js';
import { supabaseStore } from './store.js';

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

const kind = process.argv[2] as BriefKind;
if (kind !== 'pre-market' && kind !== 'close-recap')
  throw new Error('usage: brief-main.ts pre-market|close-recap');

const apiKey = process.env['RESEND_API_KEY']?.trim();
const to = process.env['BRIEF_EMAIL_TO']?.trim();
const from = process.env['BRIEF_EMAIL_FROM']?.trim() || 'Marsad <onboarding@resend.dev>';
const sendEmail =
  apiKey && to
    ? async (subject: string, text: string) => {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to: [to], subject, text }),
        });
        if (!res.ok) throw new Error(`Resend answered ${res.status}`);
      }
    : undefined;

const minutes = Number(process.env['BRIEF_MINUTES_BEFORE_OPEN'] ?? '60');
const run = await runBriefJob({
  store: supabaseStore(need('SUPABASE_URL'), need('SUPABASE_SECRET_KEY')),
  now: () => new Date(),
  kind,
  minutesBeforeOpen: Number.isFinite(minutes) ? minutes : 60,
  ...(sendEmail ? { sendEmail } : {}),
});
console.log(
  `brief-${kind}: ${run.status}, ${run.latency_ms} ms${run.error ? `, error: ${run.error}` : ''}${run.details ? ` details: ${JSON.stringify(run.details)}` : ''}`,
);
if (run.status === 'error') process.exitCode = 1;
