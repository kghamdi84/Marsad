import { STARTING_TICKERS, normalizeTicker } from '@marsad/core';
import { supabase } from './supabase';

/**
 * Editing the viewer's watchlist (council batch 3). Each person has one list, made on first edit from the starting
 * tickers they were already seeing, so adding a ticker never drops the others. Every write goes through row-level
 * security (`owner_id = auth.uid()`). A ticker added here gets daily bars from the next nightly bars run.
 */
function client() {
  if (!supabase) throw new Error('not configured');
  return supabase;
}

export const MAX_WATCHLIST = 40;

/** The saved tickers in order, or the starting list when nothing is saved yet. */
export async function loadWatchlist(): Promise<{ tickers: string[]; saved: boolean }> {
  const r = await client()
    .from('watchlist_items')
    .select('ticker, position')
    .order('position', { ascending: true })
    .limit(100);
  if (r.error) throw new Error(`watchlist_items: ${r.error.message}`);
  const tickers = [...new Set(((r.data ?? []) as { ticker: string }[]).map((x) => x.ticker))];
  return tickers.length > 0
    ? { tickers, saved: true }
    : { tickers: [...STARTING_TICKERS], saved: false };
}

async function listId(): Promise<number> {
  const found = await client().from('watchlists').select('id').order('position').limit(1);
  if (found.error) throw new Error(`watchlists: ${found.error.message}`);
  const row = (found.data ?? [])[0] as { id: number } | undefined;
  if (row) return row.id;
  const made = await client()
    .from('watchlists')
    .insert({ name: 'Watchlist' })
    .select('id')
    .single();
  if (made.error) throw new Error(`watchlists: ${made.error.message}`);
  return (made.data as { id: number }).id;
}

/** Saves the list exactly as given, in this order: removed tickers are deleted, the rest are upserted with positions. */
export async function saveWatchlist(tickers: readonly string[]): Promise<void> {
  const clean = [
    ...new Set(tickers.map((t) => normalizeTicker(t)).filter((t): t is string => t !== null)),
  ];
  if (clean.length > MAX_WATCHLIST) throw new Error(`At most ${MAX_WATCHLIST} tickers.`);
  const id = await listId();
  const del = client().from('watchlist_items').delete().eq('watchlist_id', id);
  const gone = await (clean.length > 0 ? del.not('ticker', 'in', `(${clean.join(',')})`) : del);
  if (gone.error) throw new Error(`watchlist_items: ${gone.error.message}`);
  if (clean.length === 0) return;
  const up = await client()
    .from('watchlist_items')
    .upsert(
      clean.map((ticker, position) => ({ watchlist_id: id, ticker, position })),
      { onConflict: 'watchlist_id,ticker' },
    );
  if (up.error) throw new Error(`watchlist_items: ${up.error.message}`);
}

/** Sets or clears the sector fund of one saved ticker (used for strength against the sector). */
export async function setSector(ticker: string, etf: string | null): Promise<void> {
  const r = await client().from('watchlist_items').update({ sector_etf: etf }).eq('ticker', ticker);
  if (r.error) throw new Error(`watchlist_items: ${r.error.message}`);
}

/** The list with one ticker added at the end; null if the ticker is not a valid symbol. */
export function withTicker(list: readonly string[], input: string): string[] | null {
  const t = normalizeTicker(input);
  if (!t) return null;
  return list.includes(t) ? [...list] : [...list, t];
}

/** The list with one ticker moved one place up (-1) or down (+1). */
export function moved(list: readonly string[], ticker: string, dir: -1 | 1): string[] {
  const i = list.indexOf(ticker);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return [...list];
  const out = [...list];
  [out[i], out[j]] = [out[j] as string, out[i] as string];
  return out;
}
