import { DEFAULT_SHARIAH, type ShariahSettings } from '@marsad/core';
import { supabase } from './supabase';

function client() {
  if (!supabase) throw new Error('not configured');
  return supabase;
}

export interface Preferences {
  shariah: ShariahSettings & { enabled: boolean };
}

/** The owner's preferences; defaults (Shariah aid off) when none are saved yet. */
export async function loadPreferences(): Promise<Preferences> {
  const r = await client()
    .from('user_settings')
    .select('shariah_screen, shariah_basis, shariah_debt_max, shariah_cash_max')
    .maybeSingle();
  if (r.error) throw new Error(`user_settings: ${r.error.message}`);
  const x = (r.data ?? null) as Record<string, unknown> | null;
  return {
    shariah: {
      enabled: x?.['shariah_screen'] === true,
      basis: x?.['shariah_basis'] === 'assets' ? 'assets' : DEFAULT_SHARIAH.basis,
      debtMax: x ? Number(x['shariah_debt_max']) : DEFAULT_SHARIAH.debtMax,
      cashMax: x ? Number(x['shariah_cash_max']) : DEFAULT_SHARIAH.cashMax,
    },
  };
}

export async function savePreferences(p: Preferences): Promise<void> {
  const r = await client().from('user_settings').upsert(
    {
      shariah_screen: p.shariah.enabled,
      shariah_basis: p.shariah.basis,
      shariah_debt_max: p.shariah.debtMax,
      shariah_cash_max: p.shariah.cashMax,
    },
    { onConflict: 'owner_id' },
  );
  if (r.error) throw new Error(`user_settings: ${r.error.message}`);
}
