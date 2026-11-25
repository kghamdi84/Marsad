import type { EarningsEstimate, EconEvent } from '@marsad/core';
import { supabase } from './supabase';

function client() {
  if (!supabase) throw new Error('not configured');
  return supabase;
}

export interface StoredEstimate extends EarningsEstimate {
  ticker: string;
  cik: string;
}

export interface CalendarData {
  /** The newest calendar snapshot, or null before the first run. */
  econ: { fetchedAt: string; version: string; events: EconEvent[] } | null;
  earnings: { computedAt: string; estimates: StoredEstimate[] } | null;
}

/** The newest economic-calendar and earnings-estimate snapshots. Every read goes through row-level security. */
export async function loadCalendar(): Promise<CalendarData> {
  const [econR, earnR] = await Promise.all([
    client()
      .from('econ_calendar_snapshots')
      .select('*')
      .order('fetched_at', { ascending: false })
      .limit(1),
    client()
      .from('earnings_estimate_snapshots')
      .select('*')
      .order('computed_at', { ascending: false })
      .limit(1),
  ]);
  if (econR.error) throw new Error(`econ_calendar_snapshots: ${econR.error.message}`);
  if (earnR.error) throw new Error(`earnings_estimate_snapshots: ${earnR.error.message}`);
  const e = (econR.data ?? [])[0] as Record<string, unknown> | undefined;
  const g = (earnR.data ?? [])[0] as Record<string, unknown> | undefined;
  return {
    econ: e
      ? {
          fetchedAt: String(e['fetched_at']),
          version: String(e['version']),
          events: (e['events'] ?? []) as EconEvent[],
        }
      : null,
    earnings: g
      ? {
          computedAt: String(g['computed_at']),
          estimates: (g['estimates'] ?? []) as StoredEstimate[],
        }
      : null,
  };
}
