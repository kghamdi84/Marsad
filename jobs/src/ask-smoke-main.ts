/**
 * One-off smoke test of the Ask Edge Function (checklist 8.1), run by hand from the Ask smoke test workflow, with
 * Khaled's go-ahead 2026-11-28. Signs in as the one Marsad account with the MARSAD_PASSWORD secret (the same password
 * the Set password workflow sets), calls Ask's free status mode, then sends ONE question and prints the reply state,
 * answer, verification and cost. Writes nothing itself (Ask writes its own ask_log row and ai_usage row, as for any
 * question). Never logs the email, the password or a token. The default question is about a public index fund, not
 * about his holdings, so the log holds no personal data.
 */
import { createClient } from '@supabase/supabase-js';
import { pickAccount } from './set-password.js';

function need(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing secret ${name}`);
  return v.trim();
}

const url = need('SUPABASE_URL').replace(/\/+$/, '');
const serviceKey = need('SUPABASE_SECRET_KEY');
const password = need('MARSAD_PASSWORD');
const question =
  process.env['ASK_QUESTION']?.trim() ||
  'What is the latest stored daily close for SPY, and as of what date?';
if (question.length > 500) throw new Error('ASK_QUESTION is longer than 500 characters');

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const list = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
if (list.error) throw new Error(`Could not list accounts: ${list.error.message}`);
const pick = pickAccount(list.data.users, process.env['BRIEF_EMAIL_TO']?.trim() || null);
if ('error' in pick) throw new Error(pick.error);
const email = list.data.users.find((u) => u.id === pick.id)?.email;
if (!email) throw new Error('The account has no email to sign in with');

// Password sign-in through the Auth REST endpoint; the project key is only the gateway key here.
const signIn = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: serviceKey, 'content-type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const session = (await signIn.json().catch(() => ({}))) as { access_token?: string; msg?: string };
if (!signIn.ok || !session.access_token)
  throw new Error(`Sign-in failed (HTTP ${signIn.status}): ${String(session.msg ?? 'no token')}`);
console.log(`ask-smoke: signed in (account ending ${pick.id.slice(-4)})`);

async function callAsk(body: Record<string, unknown>): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${url}/functions/v1/ask`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${session.access_token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const status = await callAsk({ mode: 'status' });
console.log(`ask-smoke: status HTTP ${status.status} ${JSON.stringify(status.json)}`);

console.log(`ask-smoke: question: ${question}`);
const started = Date.now();
const r = await callAsk({ question });
const secs = ((Date.now() - started) / 1000).toFixed(1);
const j = (r.json ?? {}) as Record<string, unknown>;
console.log(`ask-smoke: HTTP ${r.status} in ${secs} s, state=${String(j['state'])}`);
for (const k of ['verified', 'model', 'usd', 'asOf', 'as_of', 'reason', 'fallback']) {
  if (j[k] !== undefined) console.log(`ask-smoke: ${k}=${JSON.stringify(j[k])}`);
}
if (typeof j['answer'] === 'string') console.log(`ask-smoke: answer: ${j['answer'].slice(0, 800)}`);
if (typeof j['text'] === 'string') console.log(`ask-smoke: text: ${j['text'].slice(0, 800)}`);
if (Array.isArray(j['citations'])) console.log(`ask-smoke: citations: ${j['citations'].length}`);
if (j['state'] === undefined)
  console.log(`ask-smoke: raw reply: ${JSON.stringify(r.json).slice(0, 600)}`);
