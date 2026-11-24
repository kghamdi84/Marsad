import { createClient } from '@supabase/supabase-js';
import type {
  CompanyRef,
  Filing,
  FredObservation,
  GprDay,
  Halt,
  JobRunRecord,
  Split,
  UpcomingRow,
} from '@marsad/core';

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
  upsertMarketHolidays(rows: readonly UpcomingRow[], fetchedAt: Date): Promise<number>;
  upsertSplits(splits: readonly Split[], fetchedAt: Date): Promise<number>;
  /** Stored FRED observations for a series between two dates, inclusive, oldest first. */
  getFredRange(series: string, from: string, to: string): Promise<FredObservation[]>;
  upsertInstruments(companies: readonly CompanyRef[]): Promise<number>;
  upsertFilings(cik: string, filings: readonly Filing[], fetchedAt: Date): Promise<number>;
  upsertHalts(halts: readonly Halt[], seenAt: Date): Promise<number>;
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
    async upsertMarketHolidays(rows, fetchedAt) {
      const out = rows.map((r) => ({
        date: r.date,
        exchange: r.exchange,
        name: r.name,
        status: r.status,
        open_at: r.open ?? null,
        close_at: r.close ?? null,
        fetched_at: fetchedAt.toISOString(),
      }));
      const { error } = await db
        .from('market_holidays')
        .upsert(out, { onConflict: 'exchange,date' });
      if (error) throw new Error(`market_holidays upsert failed: ${error.message}`);
      return out.length;
    },
    async upsertSplits(splits, fetchedAt) {
      const out = splits
        .filter((s) => s.vendorId !== undefined)
        .map((s) => ({
          vendor_id: s.vendorId,
          ticker: s.ticker,
          execution_date: s.executionDate,
          split_from: s.splitFrom,
          split_to: s.splitTo,
          adjustment_type: s.adjustmentType,
          historical_adjustment_factor: s.historicalAdjustmentFactor ?? null,
          fetched_at: fetchedAt.toISOString(),
        }));
      if (out.length === 0) return 0;
      const { error } = await db.from('splits').upsert(out, { onConflict: 'vendor_id' });
      if (error) throw new Error(`splits upsert failed: ${error.message}`);
      return out.length;
    },
    async getFredRange(series, from, to) {
      const { data, error } = await db
        .from('fred_observations')
        .select('date, value')
        .eq('series_id', series)
        .gte('date', from)
        .lte('date', to)
        .order('date', { ascending: true });
      if (error) throw new Error(`fred_observations read failed: ${error.message}`);
      return (data ?? []).map((r) => ({
        date: r.date as string,
        value: r.value === null ? null : Number(r.value),
      }));
    },
    async upsertInstruments(companies) {
      if (companies.length === 0) return 0;
      const rows = companies.map((c) => ({ cik: c.cik, ticker: c.ticker, name: c.name || null }));
      const { error } = await db.from('instruments').upsert(rows, { onConflict: 'cik' });
      if (error) throw new Error(`instruments upsert failed: ${error.message}`);
      return rows.length;
    },
    async upsertFilings(cik, filings, fetchedAt) {
      let written = 0;
      for (let i = 0; i < filings.length; i += CHUNK) {
        const rows = filings.slice(i, i + CHUNK).map((f) => ({
          accession: f.accession,
          cik,
          form: f.form,
          filing_date: f.filingDate,
          accepted_at: f.acceptedAt,
          primary_document: f.primaryDocument,
          items: f.items,
          fetched_at: fetchedAt.toISOString(),
        }));
        const { error } = await db.from('filings').upsert(rows, { onConflict: 'accession' });
        if (error) throw new Error(`filings upsert failed: ${error.message}`);
        written += rows.length;
      }
      return written;
    },
    async upsertHalts(halts, seenAt) {
      if (halts.length === 0) return 0;
      const rows = halts.map((h) => ({
        symbol: h.symbol,
        halted_at: h.haltedAt.toISOString(),
        name: h.name || null,
        market: h.market || null,
        reason_code: h.reasonCode,
        reason_meaning: h.reasonMeaning,
        news_related: h.newsRelated,
        resumption_quote_at: h.resumptionQuoteAt?.toISOString() ?? null,
        resumption_trade_at: h.resumptionTradeAt?.toISOString() ?? null,
        pause_threshold_price: h.pauseThresholdPrice,
        active: h.active,
        last_seen_at: seenAt.toISOString(),
      }));
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error } = await db
          .from('halts')
          .upsert(rows.slice(i, i + CHUNK), { onConflict: 'symbol,halted_at' });
        if (error) throw new Error(`halts upsert failed: ${error.message}`);
      }
      return rows.length;
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
