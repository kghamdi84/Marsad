import { createClient } from '@supabase/supabase-js';
import { ETF_VERSION } from '@marsad/core';
import type { EtfStore } from './etf-job.js';
import { supabaseStore } from './store.js';

export function supabaseEtfStore(url: string, secretKey: string): EtfStore {
  const db = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    async getStoredAccessions() {
      const { data, error } = await db.from('etf_reports').select('accession, version');
      if (error) throw new Error(`etf_reports read failed: ${error.message}`);
      return new Map((data ?? []).map((r) => [String(r['accession']), String(r['version'])]));
    },
    async saveEtfReport(etf, accession, report, tickers, figis) {
      if (!report.reportDate) throw new Error(`${etf} N-PORT has no report date`);
      const head = await db.from('etf_reports').upsert(
        {
          etf,
          report_date: report.reportDate,
          accession,
          version: ETF_VERSION,
          holdings: report.holdings.length,
          matched: tickers.filter((t) => t !== null).length,
          net_assets: report.netAssets,
          fetched_at: new Date().toISOString(),
        },
        { onConflict: 'etf,report_date' },
      );
      if (head.error) throw new Error(`etf_reports upsert failed: ${head.error.message}`);
      const del = await db
        .from('etf_holdings')
        .delete()
        .eq('etf', etf)
        .eq('report_date', report.reportDate);
      if (del.error) throw new Error(`etf_holdings delete failed: ${del.error.message}`);
      const rows = report.holdings
        .map((h, i) => ({ h, ticker: tickers[i] ?? null, figi: figis[i] ?? null }))
        .sort((a, b) => b.h.weight - a.h.weight)
        .map(({ h, ticker, figi }, i) => ({
          etf,
          report_date: report.reportDate,
          rank: i + 1,
          name: h.name.slice(0, 200),
          cusip: h.cusip,
          isin: h.isin,
          ticker,
          figi,
          weight: h.weight,
          value_usd: h.valueUsd,
          asset_cat: h.assetCat,
        }));
      for (let i = 0; i < rows.length; i += 500) {
        const ins = await db.from('etf_holdings').insert(rows.slice(i, i + 500));
        if (ins.error) throw new Error(`etf_holdings insert failed: ${ins.error.message}`);
      }
      return rows.length;
    },
    recordRun: supabaseStore(url, secretKey).recordRun,
  };
}
