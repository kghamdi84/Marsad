/**
 * Sets the password of Khaled's Marsad account (ADR 0039), run by hand from the Set password workflow. Reads
 * SUPABASE_URL, SUPABASE_SECRET_KEY, MARSAD_PASSWORD and BRIEF_EMAIL_TO from GitHub secrets; never logs any of
 * them. Uses the Supabase admin API, so no email is sent.
 */
import { createClient } from '@supabase/supabase-js';
import { checkPassword, pickAccount } from './set-password.js';

function need(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing secret ${name}`);
  return v;
}

const password = need('MARSAD_PASSWORD');
const problem = checkPassword(password);
if (problem) throw new Error(problem);

const db = createClient(need('SUPABASE_URL').trim(), need('SUPABASE_SECRET_KEY').trim(), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const list = await db.auth.admin.listUsers({ page: 1, perPage: 100 });
if (list.error) throw new Error(`Could not list accounts: ${list.error.message}`);
const pick = pickAccount(list.data.users, need('BRIEF_EMAIL_TO'));
if ('error' in pick) throw new Error(pick.error);
const r = await db.auth.admin.updateUserById(pick.id, { password });
if (r.error) throw new Error(`Supabase refused the password: ${r.error.message}`);
console.log(`set-password: ok, password set for account ending ${pick.id.slice(-4)}`);
