import { createClient } from '@supabase/supabase-js';
import type { QualityStore } from './quality-job.js';
import { supabaseStore } from './store.js';

/** The quality screen's reads and writes with the secret key. */
export function supabaseQualityStore(url: string, secretKey: string): QualityStore {
  const db = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const main = supabaseStore(url, secretKey);
  return {
    async getLatestUniverse() {
      const head = await db
        .from('universe_members')
        .select('month_start')
        .order('month_start', { ascending: false })
        .limit(1);
      if (head.error) throw new Error(`universe_members read failed: ${head.error.message}`);
      const month = head.data?.[0]?.['month_start'] as string | undefined;
      if (!month) return null;
      const { data, error } = await db
        .from('universe_members')
        .select('ticker')
        .eq('month_start', month)
        .order('rank')
        .limit(1000);
      if (error) throw new Error(`universe_members read failed: ${error.message}`);
      return { monthStart: month, tickers: (data ?? []).map((r) => String(r['ticker'])) };
    },
    async getLatestCloses() {
      const from = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
      const last = (await main.loadSnapshots(from)).at(-1);
      return last
        ? { date: last.date, closes: new Map(last.rows.map((r) => [r.ticker, r.close])) }
        : null;
    },
    async saveQualityScreen(run, rows) {
      const head = await db.from('quality_screen_runs').upsert(
        {
          as_of: run.asOf,
          version: run.version,
          fiscal_year: run.fiscalYear,
          price_date: run.priceDate,
          universe: run.universe,
          no_cik: run.noCik,
          eligible: run.eligible,
          passed: run.passed,
          excluded: run.excluded,
          insufficient: run.insufficient,
        },
        { onConflict: 'as_of' },
      );
      if (head.error) throw new Error(`quality_screen_runs upsert failed: ${head.error.message}`);
      // A rerun the same day replaces that day's list.
      const del = await db.from('quality_screen').delete().eq('as_of', run.asOf);
      if (del.error) throw new Error(`quality_screen delete failed: ${del.error.message}`);
      if (rows.length === 0) return 0;
      const ins = await db.from('quality_screen').insert(
        rows.map((r) => ({
          as_of: run.asOf,
          rank: r.rank,
          ticker: r.ticker,
          cik: r.cik,
          name: r.name,
          passes: r.passes,
          quality: Math.round(r.quality * 100) / 100,
          value: Math.round(r.value * 100) / 100,
          combined: Math.round(r.combined * 100) / 100,
          metrics: r.metrics,
          pct: r.pct,
          notes: r.notes ?? [],
          price: r.price,
        })),
      );
      if (ins.error) throw new Error(`quality_screen insert failed: ${ins.error.message}`);
      return rows.length;
    },
    recordRun: main.recordRun,
  };
}
