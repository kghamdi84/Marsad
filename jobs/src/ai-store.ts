import { createClient } from '@supabase/supabase-js';
import type { FinancialFact } from '@marsad/core';
import type { AiUsageRow } from './anthropic.js';
import type { AiOutputKind, AiOutputRow, AiStore, StoredOutputKey } from './ai-summaries-job.js';
import { supabaseStore } from './store.js';

/** The AI jobs' reads and writes with the secret key (ADR 0007). */
export function supabaseAiStore(
  url: string,
  secretKey: string,
): AiStore & {
  getThesisTickers(): Promise<string[]>;
} {
  const db = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const main = supabaseStore(url, secretKey);
  return {
    recordRun: (run) => main.recordRun(run),
    getWatchlistTickers: () => main.getWatchlistTickers(),
    async getHoldingTickers() {
      return [...new Set((await main.getOpenHoldings()).map((h) => h.ticker))];
    },
    async getThesisTickers() {
      const { data, error } = await db.from('theses').select('ticker').limit(5000);
      if (error) throw new Error(`theses read failed: ${error.message}`);
      return [...new Set((data ?? []).map((r) => String(r.ticker)))];
    },
    async spent(now) {
      const day = now.toISOString().slice(0, 10);
      const monthStart = `${day.slice(0, 7)}-01T00:00:00Z`;
      let dailyUsd = 0;
      let monthlyUsd = 0;
      for (let from = 0; ; from += 1000) {
        const { data, error } = await db
          .from('ai_usage')
          .select('created_at, usd')
          .gte('created_at', monthStart)
          .order('id', { ascending: true })
          .range(from, from + 999);
        if (error) throw new Error(`ai_usage read failed: ${error.message}`);
        for (const r of data ?? []) {
          const usd = Number(r.usd);
          monthlyUsd += usd;
          if (new Date(String(r.created_at)).toISOString().slice(0, 10) === day) dailyUsd += usd;
        }
        if ((data ?? []).length < 1000) break;
      }
      return { dailyUsd, monthlyUsd };
    },
    async savedCaps() {
      // Every saved cap counts, so the lowest one wins: a cap can only lower spend, never raise it.
      const { data, error } = await db
        .from('user_settings')
        .select('ai_daily_cap_usd, ai_monthly_cap_usd')
        .limit(1000);
      if (error) throw new Error(`user_settings read failed: ${error.message}`);
      const low = (k: 'ai_daily_cap_usd' | 'ai_monthly_cap_usd') => {
        const vs = (data ?? [])
          .map((r) => (r[k] === null ? null : Number(r[k])))
          .filter((v): v is number => v !== null && v > 0);
        return vs.length ? Math.min(...vs) : null;
      };
      const caps = { dailyUsd: low('ai_daily_cap_usd'), monthlyUsd: low('ai_monthly_cap_usd') };
      return caps.dailyUsd === null && caps.monthlyUsd === null ? null : caps;
    },
    async recordUsage(row: AiUsageRow) {
      const { error } = await db.from('ai_usage').insert(row);
      if (error) throw new Error(`ai_usage insert failed: ${error.message}`);
    },
    async getCiks(tickers) {
      const out = new Map<string, string>();
      if (tickers.length === 0) return out;
      const { data, error } = await db
        .from('instruments')
        .select('ticker, cik')
        .in('ticker', [...tickers])
        .not('cik', 'is', null);
      if (error) throw new Error(`instruments read failed: ${error.message}`);
      for (const r of data ?? []) out.set(String(r.ticker), String(r.cik));
      return out;
    },
    async getFinancialFacts(cik) {
      const out: FinancialFact[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await db
          .from('financial_facts')
          .select(
            'taxonomy, concept, unit, period_start, period_end, value, accession, form, fiscal_year, fiscal_period, filed, frame',
          )
          .eq('cik', cik)
          .order('fact_key', { ascending: true })
          .range(from, from + 999);
        if (error) throw new Error(`financial_facts read failed: ${error.message}`);
        for (const f of data ?? [])
          out.push({
            taxonomy: String(f.taxonomy),
            concept: String(f.concept),
            unit: String(f.unit),
            start: f.period_start ? String(f.period_start) : null,
            end: String(f.period_end),
            value: Number(f.value),
            accession: String(f.accession),
            form: String(f.form),
            fy: typeof f.fiscal_year === 'number' ? f.fiscal_year : null,
            fp: f.fiscal_period ? String(f.fiscal_period) : null,
            filed: String(f.filed),
            frame: f.frame ? String(f.frame) : null,
          });
        if ((data ?? []).length < 1000) break;
      }
      return out;
    },
    async getAnnualRiskSection(cik) {
      const { data, error } = await db
        .from('annual_sections')
        .select('period_end, filing_date, filing_url, text')
        .eq('cik', cik)
        .eq('section', 'risk_factors')
        .order('period_end', { ascending: false })
        .limit(1);
      if (error) throw new Error(`annual_sections read failed: ${error.message}`);
      const r = (data ?? [])[0];
      return r
        ? {
            periodEnd: String(r.period_end),
            filingDate: String(r.filing_date),
            url: String(r.filing_url),
            text: String(r.text),
          }
        : null;
    },
    async getQuarterlySection(cik) {
      const { data, error } = await db
        .from('quarterly_sections')
        .select('accession, period_end, filing_date, filing_url, text, no_material_changes')
        .eq('cik', cik)
        .order('filing_date', { ascending: false })
        .limit(1);
      if (error) throw new Error(`quarterly_sections read failed: ${error.message}`);
      const r = (data ?? [])[0];
      return r
        ? {
            accession: String(r.accession),
            periodEnd: r.period_end ? String(r.period_end) : null,
            filingDate: String(r.filing_date),
            url: String(r.filing_url),
            text: String(r.text),
            noMaterialChanges: Boolean(r.no_material_changes),
          }
        : null;
    },
    async getEightKs(cik, since) {
      const { data, error } = await db
        .from('filings')
        .select('accession, filing_date, items, primary_document')
        .eq('cik', cik)
        .in('form', ['8-K', '8-K/A'])
        .gte('filing_date', since)
        .order('filing_date', { ascending: false })
        .limit(20);
      if (error) throw new Error(`filings read failed: ${error.message}`);
      return (data ?? []).map((r) => {
        const accession = String(r.accession);
        const doc = r.primary_document ? String(r.primary_document) : null;
        return {
          accession,
          filingDate: String(r.filing_date),
          items: (r.items ?? []) as string[],
          url: doc
            ? `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, '')}/${doc}`
            : null,
        };
      });
    },
    async getOutputKeys(kind: AiOutputKind, tickers) {
      if (tickers.length === 0) return [];
      const { data, error } = await db
        .from('ai_outputs')
        .select('ticker, source_key, source, fallback_reason')
        .eq('kind', kind)
        .in('ticker', [...tickers])
        .order('created_at', { ascending: false })
        .limit(5000);
      if (error) throw new Error(`ai_outputs read failed: ${error.message}`);
      return (data ?? []).map((r): StoredOutputKey => ({
        ticker: r.ticker === null ? null : String(r.ticker),
        sourceKey: String(r.source_key),
        source: r.source === 'model' ? 'model' : 'template',
        reason: r.fallback_reason === null ? null : String(r.fallback_reason),
      }));
    },
    async insertOutput(row: AiOutputRow) {
      const { error } = await db.from('ai_outputs').insert(row);
      if (error) throw new Error(`ai_outputs insert failed: ${error.message}`);
    },
  };
}
