import type { ThesisDraft, ThesisStatus } from '@marsad/core';
import { supabase } from './supabase';

function client() {
  if (!supabase) throw new Error('not configured');
  return supabase;
}

export interface ThesisVersion extends ThesisDraft {
  id: number;
  createdAt: string;
}

/** Every saved version of the card for a ticker, newest first. */
export async function loadTheses(ticker: string): Promise<ThesisVersion[]> {
  const r = await client()
    .from('theses')
    .select('id, ticker, status, bull, bear, risks, change_view, sources, created_at')
    .eq('ticker', ticker)
    .order('created_at', { ascending: false })
    .limit(50);
  if (r.error) throw new Error(`theses: ${r.error.message}`);
  return ((r.data ?? []) as Record<string, unknown>[]).map((x) => ({
    id: Number(x['id']),
    ticker: String(x['ticker']),
    status: String(x['status']) as ThesisStatus,
    bull: String(x['bull']),
    bear: String(x['bear']),
    risks: (x['risks'] ?? []) as string[],
    changeView: String(x['change_view']),
    sources: (x['sources'] ?? []) as string[],
    createdAt: String(x['created_at']),
  }));
}

/**
 * Saves a new version, then sets the same thesis status on any open holding of the ticker, so the rotation
 * signal reads the current view.
 */
export async function saveThesis(d: ThesisDraft): Promise<void> {
  const r = await client().from('theses').insert({
    ticker: d.ticker,
    status: d.status,
    bull: d.bull,
    bear: d.bear,
    risks: d.risks,
    change_view: d.changeView,
    sources: d.sources,
  });
  if (r.error) throw new Error(`theses: ${r.error.message}`);
  const h = await client()
    .from('holdings')
    .update({ thesis_status: d.status })
    .eq('ticker', d.ticker)
    .is('closed_on', null);
  if (h.error) throw new Error(`holdings: ${h.error.message}`);
}
