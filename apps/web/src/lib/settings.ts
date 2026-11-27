import { DEFAULT_SHARIAH, type ShariahSettings } from '@marsad/core';
import { supabase } from './supabase';

function client() {
  if (!supabase) throw new Error('not configured');
  return supabase;
}

export interface Preferences {
  shariah: ShariahSettings & { enabled: boolean };
  /** AI spending caps in USD; null while unset (AI stays off). */
  ai: { dailyUsd: number | null; monthlyUsd: number | null };
}

/** The owner's preferences; defaults (Shariah aid off) when none are saved yet. */
export async function loadPreferences(): Promise<Preferences> {
  const r = await client()
    .from('user_settings')
    .select(
      'shariah_screen, shariah_basis, shariah_debt_max, shariah_cash_max, ai_daily_cap_usd, ai_monthly_cap_usd',
    )
    .maybeSingle();
  if (r.error) throw new Error(`user_settings: ${r.error.message}`);
  const x = (r.data ?? null) as Record<string, unknown> | null;
  /** A stored fraction strictly between 0 and 1, or the default (never NaN on screen). */
  const fraction = (v: unknown, fallback: number) => {
    const n = v === null || v === undefined ? Number.NaN : Number(v);
    return Number.isFinite(n) && n > 0 && n < 1 ? n : fallback;
  };
  return {
    shariah: {
      enabled: x?.['shariah_screen'] === true,
      basis: x?.['shariah_basis'] === 'assets' ? 'assets' : DEFAULT_SHARIAH.basis,
      debtMax: fraction(x?.['shariah_debt_max'], DEFAULT_SHARIAH.debtMax),
      cashMax: fraction(x?.['shariah_cash_max'], DEFAULT_SHARIAH.cashMax),
    },
    ai: {
      dailyUsd: x?.['ai_daily_cap_usd'] == null ? null : Number(x['ai_daily_cap_usd']),
      monthlyUsd: x?.['ai_monthly_cap_usd'] == null ? null : Number(x['ai_monthly_cap_usd']),
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
      ai_daily_cap_usd: p.ai.dailyUsd,
      ai_monthly_cap_usd: p.ai.monthlyUsd,
    },
    { onConflict: 'owner_id' },
  );
  if (r.error) throw new Error(`user_settings: ${r.error.message}`);
}

export interface AlertPreferences {
  /** Local "HH:MM" in the alert time zone (Asia/Riyadh); the window may cross midnight. */
  quietStart: string;
  quietEnd: string;
  dailyPushCap: number;
  /** False while nothing is saved and the pipeline uses its defaults. */
  saved: boolean;
}

/** The pipeline defaults (core DEFAULT_ALERT_SETTINGS): 23:00 to 07:00 Riyadh and 8 pushes a day. */
export const ALERT_DEFAULTS = { quietStart: '23:00', quietEnd: '07:00', dailyPushCap: 8 } as const;

/** Quiet hours and the daily push cap (alert_preferences, owner only); the defaults when none are saved. */
export async function loadAlertPreferences(): Promise<AlertPreferences> {
  const r = await client()
    .from('alert_preferences')
    .select('quiet_start, quiet_end, daily_push_cap')
    .maybeSingle();
  if (r.error) throw new Error(`alert_preferences: ${r.error.message}`);
  const x = (r.data ?? null) as Record<string, unknown> | null;
  if (!x) return { ...ALERT_DEFAULTS, saved: false };
  return {
    quietStart: String(x['quiet_start']),
    quietEnd: String(x['quiet_end']),
    dailyPushCap: Number(x['daily_push_cap']),
    saved: true,
  };
}

export async function saveAlertPreferences(p: Omit<AlertPreferences, 'saved'>): Promise<void> {
  const r = await client().from('alert_preferences').upsert(
    {
      quiet_start: p.quietStart,
      quiet_end: p.quietEnd,
      daily_push_cap: p.dailyPushCap,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'owner_id' },
  );
  if (r.error) throw new Error(`alert_preferences: ${r.error.message}`);
}
