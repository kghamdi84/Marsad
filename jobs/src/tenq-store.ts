import { createClient } from '@supabase/supabase-js';
import type { TenQFiling, TenQStore } from './tenq-job.js';
import { supabaseStore } from './store.js';
import { TENQ_VERSION } from '@marsad/core';

export function supabaseTenQStore(url: string, secretKey: string): TenQStore {
  const db = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    async getRecentTenQ(tickers) {
      const inst = await db
        .from('instruments')
        .select('cik, ticker')
        .in('ticker', [...tickers]);
      if (inst.error) throw new Error(`instruments read failed: ${inst.error.message}`);
      const out: TenQFiling[] = [];
      for (const i of inst.data ?? []) {
        const cik = String(i['cik']);
        const { data, error } = await db
          .from('filings')
          .select('accession, filing_date, primary_document')
          .eq('cik', cik)
          .eq('form', '10-Q')
          .order('filing_date', { ascending: false })
          .limit(2);
        if (error) throw new Error(`filings read failed: ${error.message}`);
        for (const f of data ?? [])
          if (f['primary_document'])
            out.push({
              accession: String(f['accession']),
              cik,
              ticker: String(i['ticker']),
              filingDate: String(f['filing_date']),
              periodEnd: null,
              primaryDocument: String(f['primary_document']),
            });
      }
      return out;
    },
    async getStoredQuarterly(accessions) {
      if (accessions.length === 0) return new Set();
      const { data, error } = await db
        .from('quarterly_sections')
        .select('accession')
        .in('accession', [...accessions]);
      if (error) throw new Error(`quarterly_sections read failed: ${error.message}`);
      return new Set((data ?? []).map((r) => String(r['accession'])));
    },
    async saveQuarterly(rows) {
      if (rows.length === 0) return 0;
      const { error } = await db.from('quarterly_sections').upsert(
        rows.map((r) => ({
          accession: r.accession,
          cik: r.cik,
          ticker: r.ticker,
          period_end: r.periodEnd,
          filing_date: r.filingDate,
          filing_url: r.url,
          text: r.text,
          no_material_changes: r.noMaterialChanges,
          version: TENQ_VERSION,
        })),
        { onConflict: 'accession' },
      );
      if (error) throw new Error(`quarterly_sections upsert failed: ${error.message}`);
      return rows.length;
    },
    recordRun: supabaseStore(url, secretKey).recordRun,
  };
}
