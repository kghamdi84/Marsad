import { createClient } from '@supabase/supabase-js';
import type { EarningsGuardStore } from './earnings-guard-job.js';
import { supabaseStore } from './store.js';
import { supabaseTickerSummaryStore } from './ticker-summary-store.js';

/** The earnings guard's reads and writes with the secret key (ADR 0052). */
export function supabaseEarningsGuardStore(url: string, secretKey: string): EarningsGuardStore {
  const db = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const main = supabaseStore(url, secretKey);
  const summary = supabaseTickerSummaryStore(url, secretKey);
  return {
    getHolidays: (exchange) => main.getHolidays(exchange),
    getOpenHoldings: () => main.getOpenHoldings(),
    getDailyBars: (ticker) => main.getDailyBars(ticker),
    getBarsFetchedAt: (ticker) => main.getBarsFetchedAt(ticker),
    getAlertPreferences: () => main.getAlertPreferences(),
    getRecentAlerts: (since) => main.getRecentAlerts(since),
    insertAlerts: (rows) => main.insertAlerts(rows),
    latest: (table, columns, orderBy, limit) => main.latest(table, columns, orderBy, limit),
    recordRun: (run) => main.recordRun(run),
    getResearch: (tickers) => summary.getResearch(tickers),
    async getEarningsEstimates() {
      const { data, error } = await db
        .from('earnings_estimate_snapshots')
        .select('computed_at, estimates')
        .order('computed_at', { ascending: false })
        .limit(1);
      if (error) throw new Error(`earnings_estimate_snapshots read failed: ${error.message}`);
      const row = (data ?? [])[0];
      if (!row) return null;
      const list = (row.estimates ?? []) as Record<string, unknown>[];
      const day = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
      return {
        computedAt: new Date(String(row.computed_at)).toISOString(),
        rows: list
          .filter(
            (e) =>
              typeof e['ticker'] === 'string' && day(e['date']) && day(e['from']) && day(e['to']),
          )
          .map((e) => ({
            ticker: e['ticker'] as string,
            date: e['date'] as string,
            from: e['from'] as string,
            to: e['to'] as string,
          })),
      };
    },
    async getRuleAlerts(ruleId, since) {
      const { data, error } = await db
        .from('alerts')
        .select('id, created_at, event_id:input->>eventId')
        .eq('rule_id', ruleId)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(1000);
      if (error) throw new Error(`alerts read failed: ${error.message}`);
      return ((data ?? []) as { id: unknown; created_at: unknown; event_id: unknown }[]).map(
        (r) => ({
          id: String(r.id),
          createdAt: new Date(String(r.created_at)).toISOString(),
          eventId: typeof r.event_id === 'string' ? r.event_id : null,
        }),
      );
    },
  };
}
