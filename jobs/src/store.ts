import { createClient } from '@supabase/supabase-js';
import type { FredObservation, GprDay, JobRunRecord } from '@marsad/core';

export interface SourceStatusUpdate {
  source: string;
  lastMessageAt: Date;
  latencyMs: number;
  planTier: 'real-time' | 'delayed' | 'end-of-day' | 'unavailable' | 'unknown';
  state: 'live' | 'delayed' | 'stale' | 'unavailable' | 'unknown';
  note: string;
}

/** The writes jobs need. Implemented over Supabase here and by fakes in tests. */
export interface Store {
  upsertGprDays(days: readonly GprDay[], fetchedAt: Date): Promise<number>;
  upsertFredObservations(
    series: string,
    observations: readonly FredObservation[],
    fetchedAt: Date,
  ): Promise<number>;
  recordRun(run: JobRunRecord): Promise<void>;
  updateSourceStatus(update: SourceStatusUpdate): Promise<void>;
}

const CHUNK = 1000;

export function supabaseStore(url: string, secretKey: string): Store {
  const db = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    async upsertGprDays(days, fetchedAt) {
      let written = 0;
      for (let i = 0; i < days.length; i += CHUNK) {
        const rows = days.slice(i, i + CHUNK).map((d) => ({
          date: d.date,
          gprd: d.gprd,
          gprd_act: d.act,
          gprd_threat: d.threat,
          gprd_ma7: d.ma7,
          gprd_ma30: d.ma30,
          fetched_at: fetchedAt.toISOString(),
        }));
        const { error } = await db.from('gpr_daily').upsert(rows, { onConflict: 'date' });
        if (error) throw new Error(`gpr_daily upsert failed: ${error.message}`);
        written += rows.length;
      }
      return written;
    },
    async upsertFredObservations(series, observations, fetchedAt) {
      let written = 0;
      for (let i = 0; i < observations.length; i += CHUNK) {
        const rows = observations.slice(i, i + CHUNK).map((o) => ({
          series_id: series,
          date: o.date,
          value: o.value,
          fetched_at: fetchedAt.toISOString(),
        }));
        const { error } = await db
          .from('fred_observations')
          .upsert(rows, { onConflict: 'series_id,date' });
        if (error) throw new Error(`fred_observations upsert failed: ${error.message}`);
        written += rows.length;
      }
      return written;
    },
    async recordRun(run) {
      const { error } = await db.from('job_runs').insert(run);
      if (error) throw new Error(`job_runs insert failed: ${error.message}`);
    },
    async updateSourceStatus(u) {
      const { error } = await db
        .from('source_status')
        .update({
          last_message_at: u.lastMessageAt.toISOString(),
          last_latency_ms: u.latencyMs,
          plan_tier: u.planTier,
          state: u.state,
          note: u.note,
          updated_at: new Date().toISOString(),
        })
        .eq('source', u.source);
      if (error) throw new Error(`source_status update failed: ${error.message}`);
    },
  };
}
