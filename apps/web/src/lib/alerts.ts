import type { CardSection, HorizonKey, Outcome, ScoredAlert } from '@marsad/core';
import { supabase } from './supabase';

function client() {
  if (!supabase) throw new Error('not configured');
  return supabase;
}

export type Verdict = 'useful' | 'noise' | 'acted';

export interface StoredAlertRow {
  id: string;
  createdAt: string;
  kind: string;
  priority: string;
  ticker: string | null;
  decision: string;
  reasons: string[];
  card: CardSection[];
  latencyMs: number | null;
  delivery: Record<string, string>;
  feedback: Verdict | null;
}

/** The newest alerts (not suppressed ones unless asked) with any feedback given. Reads go through row-level security. */
export async function loadAlerts(includeSuppressed: boolean): Promise<StoredAlertRow[]> {
  let q = client()
    .from('alerts')
    .select('id, created_at, kind, priority, ticker, decision, reasons, card, latency_ms, delivery')
    .order('created_at', { ascending: false })
    .limit(50);
  if (!includeSuppressed) q = q.neq('decision', 'suppress');
  const [a, f] = await Promise.all([
    q,
    client().from('alert_feedback').select('alert_id, verdict').limit(500),
  ]);
  if (a.error) throw new Error(`alerts: ${a.error.message}`);
  if (f.error) throw new Error(`alert_feedback: ${f.error.message}`);
  const fb = new Map(
    ((f.data ?? []) as { alert_id: string; verdict: Verdict }[]).map((x) => [
      x.alert_id,
      x.verdict,
    ]),
  );
  return ((a.data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r['id']),
    createdAt: String(r['created_at']),
    kind: String(r['kind']),
    priority: String(r['priority']),
    ticker: r['ticker'] === null ? null : String(r['ticker']),
    decision: String(r['decision']),
    reasons: (r['reasons'] ?? []) as string[],
    card: (r['card'] ?? []) as CardSection[],
    latencyMs: r['latency_ms'] === null ? null : Number(r['latency_ms']),
    delivery: (r['delivery'] ?? {}) as Record<string, string>,
    feedback: fb.get(String(r['id'])) ?? null,
  }));
}

/** Records one-tap feedback (one per alert; a new tap replaces the old one). */
export async function saveFeedback(alertId: string, verdict: Verdict): Promise<void> {
  const r = await client()
    .from('alert_feedback')
    .upsert({ alert_id: alertId, verdict }, { onConflict: 'alert_id,owner_id' });
  if (r.error) throw new Error(`feedback: ${r.error.message}`);
}

/**
 * The scorecard's raw inputs: alerts of the last 120 days (suppressed signals left out) and their stored outcomes.
 * Every summary on the page is computed from these rows in the browser.
 */
export async function loadScorecard(): Promise<{ alerts: ScoredAlert[]; outcomes: Outcome[] }> {
  const since = new Date(Date.now() - 120 * 86_400_000).toISOString();
  const [a, o] = await Promise.all([
    client()
      .from('alerts')
      .select('id, created_at, kind, ticker, rule_id, rule_status, input')
      .neq('decision', 'suppress')
      .gte('created_at', since)
      .limit(2000),
    client()
      .from('alert_outcomes')
      .select(
        'alert_id, horizon, status, note, ref_date, end_date, ret, bench_ret, excess, mfe, mae, hit',
      )
      .limit(6000),
  ]);
  if (a.error) throw new Error(`alerts: ${a.error.message}`);
  if (o.error) throw new Error(`alert_outcomes: ${o.error.message}`);
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    alerts: ((a.data ?? []) as Record<string, unknown>[]).map((r) => {
      const input = (r['input'] ?? {}) as { qualityScore?: number };
      return {
        id: String(r['id']),
        createdAt: String(r['created_at']),
        kind: String(r['kind']),
        ticker: r['ticker'] === null ? null : String(r['ticker']),
        ruleId: String(r['rule_id']),
        ruleStatus: r['rule_status'] === 'shadow' ? 'shadow' : 'live',
        ...(typeof input.qualityScore === 'number' ? { qualityScore: input.qualityScore } : {}),
      };
    }),
    outcomes: ((o.data ?? []) as Record<string, unknown>[]).map((r) => ({
      alertId: String(r['alert_id']),
      horizon: String(r['horizon']) as HorizonKey,
      status: String(r['status']) as Outcome['status'],
      note: r['note'] === null ? null : String(r['note']),
      refDate: r['ref_date'] === null ? null : String(r['ref_date']),
      endDate: r['end_date'] === null ? null : String(r['end_date']),
      ret: n(r['ret']),
      benchRet: n(r['bench_ret']),
      excess: n(r['excess']),
      mfe: n(r['mfe']),
      mae: n(r['mae']),
      hit: (r['hit'] ?? null) as Outcome['hit'],
    })),
  };
}
