import { createClient } from '@supabase/supabase-js';
import type { TauricStore } from './tauric-job.js';
import { supabaseStore } from './store.js';

/** The Tauric jobs' reads and writes with the secret key (ADR 0041). */
export function supabaseTauricStore(url: string, secretKey: string): TauricStore {
  const db = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const main = supabaseStore(url, secretKey);
  return {
    getHolidays: (exchange) => main.getHolidays(exchange),
    getWatchlistTickers: () => main.getWatchlistTickers(),
    recordRun: (run) => main.recordRun(run),
    updateSourceStatus: (u) => main.updateSourceStatus(u),
    async upsertQuotes(quotes, fetchedAt) {
      if (quotes.length === 0) return 0;
      const { error } = await db.from('price_quotes').upsert(
        quotes.map((q) => ({
          ticker: q.ticker,
          source: 'tauric',
          price: q.price,
          quote_kind: q.quoteKind,
          price_time: q.priceTime,
          session_date: q.sessionDate,
          previous_close: q.previousClose,
          previous_close_date: q.previousCloseDate,
          change: q.change,
          day_volume: q.dayVolume,
          market_state: q.marketState,
          vendor_refreshed_at: q.vendorRefreshedAt,
          plan_tier: 'unknown',
          fetched_at: fetchedAt.toISOString(),
        })),
        { onConflict: 'ticker,source' },
      );
      if (error) throw new Error(`price_quotes upsert failed: ${error.message}`);
      return quotes.length;
    },
    async getLatestDailyBar(ticker) {
      const { data, error } = await db
        .from('daily_bars')
        .select('date, close, volume')
        .eq('ticker', ticker)
        .order('date', { ascending: false })
        .limit(1);
      if (error) throw new Error(`daily_bars read failed: ${error.message}`);
      const r = data?.[0];
      return r ? { date: String(r.date), close: Number(r.close), volume: Number(r.volume) } : null;
    },
  };
}
