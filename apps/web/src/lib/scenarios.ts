import type { CatalystScenario } from '@marsad/core';
import { supabase } from './supabase';

function client() {
  if (!supabase) throw new Error('not configured');
  return supabase;
}

export interface StoredScenario extends CatalystScenario {
  active: boolean;
}

/** The owner's scenarios, newest expiry first. */
export async function loadScenarios(): Promise<StoredScenario[]> {
  const r = await client()
    .from('catalyst_scenarios')
    .select('*')
    .order('expires_on', { ascending: false })
    .limit(100);
  if (r.error) throw new Error(`catalyst_scenarios: ${r.error.message}`);
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return ((r.data ?? []) as Record<string, unknown>[]).map((x) => ({
    id: Number(x['id']),
    name: String(x['name']),
    tickers: (x['tickers'] ?? []) as string[],
    keywords: (x['keywords'] ?? []) as string[],
    triggers: {
      eightKItems: (x['eight_k_items'] ?? []) as string[],
      form4Codes: (x['form4_codes'] ?? []) as string[],
      newsMinTier: n(x['news_min_tier']) as 1 | 2 | 3 | 4 | null,
      halts: x['halts'] === true,
      movePct: n(x['move_pct']),
      volumeRatio: n(x['volume_ratio']),
    },
    plan: {
      entry: String(x['plan_entry']),
      chaseGuardPct: Number(x['chase_guard_pct']),
      invalidation: String(x['plan_invalidation']),
      size: String(x['plan_size'] ?? ''),
    },
    expiresOn: String(x['expires_on']),
    active: x['active'] === true,
  }));
}

export async function addScenario(s: Omit<CatalystScenario, 'id'>): Promise<void> {
  const r = await client().from('catalyst_scenarios').insert({
    name: s.name,
    tickers: s.tickers,
    keywords: s.keywords,
    eight_k_items: s.triggers.eightKItems,
    form4_codes: s.triggers.form4Codes,
    news_min_tier: s.triggers.newsMinTier,
    halts: s.triggers.halts,
    move_pct: s.triggers.movePct,
    volume_ratio: s.triggers.volumeRatio,
    plan_entry: s.plan.entry,
    chase_guard_pct: s.plan.chaseGuardPct,
    plan_invalidation: s.plan.invalidation,
    plan_size: s.plan.size,
    expires_on: s.expiresOn,
  });
  if (r.error) throw new Error(`catalyst_scenarios: ${r.error.message}`);
}

export async function setScenarioActive(id: number, active: boolean): Promise<void> {
  const r = await client().from('catalyst_scenarios').update({ active }).eq('id', id);
  if (r.error) throw new Error(`catalyst_scenarios: ${r.error.message}`);
}
