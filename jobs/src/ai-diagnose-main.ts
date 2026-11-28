/**
 * Read-only diagnosis of AI outputs that fell back to a template. Prints, for the newest rows of `ai_outputs`, the
 * verifier's issue lines and the start of the rejected text, so a wrong prompt or verifier rule can be seen without
 * paying for another model call. Writes nothing. Reads SUPABASE_URL and SUPABASE_SECRET_KEY; never logs them.
 */
import { createClient } from '@supabase/supabase-js';

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

const db = createClient(need('SUPABASE_URL'), need('SUPABASE_SECRET_KEY'), {
  auth: { persistSession: false },
});
const limit = Math.min(Math.max(Number(process.env['DIAGNOSE_LIMIT'] ?? '6') || 6, 1), 20);
const { data, error } = await db
  .from('ai_outputs')
  .select('kind, ticker, fallback_reason, attempts, failures, created_at')
  .not('fallback_reason', 'is', null)
  .order('created_at', { ascending: false })
  .limit(limit);
if (error) throw new Error(`ai_outputs read failed: ${error.message}`);

interface Failure {
  attempt?: number;
  kind?: string;
  details?: string[];
  rejectedText?: string | null;
}
const tally = new Map<string, number>();
for (const row of data ?? []) {
  console.log(
    `--- ${String(row.kind)} ${String(row.ticker ?? '')} ${String(row.created_at)} reason=${String(row.fallback_reason)} attempts=${String(row.attempts)}`,
  );
  for (const f of (row.failures ?? []) as Failure[]) {
    console.log(`  attempt ${String(f.attempt)} ${String(f.kind)}`);
    for (const d of f.details ?? []) {
      console.log(`    ${d.slice(0, 220)}`);
      const k = d.split(':')[0] ?? d;
      tally.set(k, (tally.get(k) ?? 0) + 1);
    }
    if (f.rejectedText)
      console.log(`    text: ${f.rejectedText.slice(0, 500).replace(/\n/g, ' / ')}`);
  }
}
console.log(
  `issue kinds across ${data?.length ?? 0} rows: ${JSON.stringify(Object.fromEntries(tally))}`,
);
