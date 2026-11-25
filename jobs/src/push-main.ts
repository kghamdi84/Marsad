/**
 * Entry point for the Web Push dispatcher (ADR 0031), run as the last step of every workflow that can create an
 * alert, a system alert or a brief. Reads SUPABASE_URL, SUPABASE_SECRET_KEY and, when set, VAPID_PRIVATE_KEY;
 * never logs them. With PUSH_TEST=1 it sends one test message to every device instead.
 */
import webpush from 'web-push';
import type { PushSender } from './push-job.js';
import { runPushJob } from './push-job.js';
import { vapidPublicKeyFor } from './push-keys.js';
import { supabasePushStore } from './push-store.js';
import { supabaseStore } from './store.js';

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

const url = need('SUPABASE_URL');
const key = need('SUPABASE_SECRET_KEY');
const privateKey = process.env['VAPID_PRIVATE_KEY']?.trim() || null;
// Push services require a contact; the site address keeps any personal address out of every request.
const SUBJECT = 'https://marsad-k84.netlify.app';

let secretPublicKey: string | null = null;
let sender: PushSender | null = null;
if (privateKey !== null) {
  secretPublicKey = vapidPublicKeyFor(privateKey);
  const vapidDetails = { subject: SUBJECT, publicKey: secretPublicKey, privateKey };
  sender = async (d, payload, m) => {
    try {
      const r = await webpush.sendNotification(
        { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } },
        payload,
        { vapidDetails, TTL: m.ttlSeconds, urgency: m.urgency, timeout: 15_000 },
      );
      return { ok: r.statusCode >= 200 && r.statusCode < 300, status: r.statusCode };
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode ?? 0;
      const body = (e as { body?: string }).body;
      return {
        ok: false,
        status,
        error: (body || (e as Error).message || 'refused').slice(0, 160),
      };
    }
  };
}

const run = await runPushJob({
  store: { ...supabasePushStore(url, key), recordRun: supabaseStore(url, key).recordRun },
  sender,
  secretPublicKey,
  now: () => new Date(),
  test: process.env['PUSH_TEST'] === '1',
});
console.log(
  `${run.job}: ${run.status}, rows ${run.rows_written ?? 0}, ${run.latency_ms} ms${run.error ? `, error: ${run.error}` : ''}${run.details ? ` details: ${JSON.stringify(run.details)}` : ''}`,
);
if (run.status === 'error') process.exitCode = 1;
