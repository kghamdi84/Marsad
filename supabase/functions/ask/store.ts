/**
 * Ask's reads and writes through supabase-js. Every read and the `ask_log` write run as the caller: the client
 * carries the caller's own JWT, so row-level security decides what Ask may see, exactly as on the web page. The
 * service key is used for one write only, the `ai_usage` rows (system spend that no signed-in user may write).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  TICKER_SUMMARY_VERSION,
  type AskAlertRow,
  type AskBreadthRow,
  type AskCompanyResearchRow,
  type AskFilingSectionRow,
  type AskHoldingRow,
  type AskRegimeRow,
  type AskTickerSummaryRow,
} from '@marsad/core';
import type { AiUsageInsert, AskLogInsert, AskStore } from './handler.ts';

const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false } } as const;

function check<T>(r: { data: T; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}

export function callerStore(url: string, publishableKey: string, accessToken: string): AskStore {
  const db: SupabaseClient = createClient(url, publishableKey, {
    ...NO_SESSION,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  return {
    async userId() {
      const r = await db.auth.getUser(accessToken);
      return r.error ? null : (r.data.user?.id ?? null);
    },
    async isOwner() {
      return check(await db.rpc('ask_is_owner'), 'ask_is_owner') === true;
    },
    async preferredCaps() {
      const row = check(
        await db
          .from('user_settings')
          .select('ai_daily_cap_usd, ai_monthly_cap_usd')
          .limit(1)
          .maybeSingle(),
        'user_settings',
      ) as { ai_daily_cap_usd: number | null; ai_monthly_cap_usd: number | null } | null;
      const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
      return { dailyUsd: n(row?.ai_daily_cap_usd), monthlyUsd: n(row?.ai_monthly_cap_usd) };
    },
    async usageSince(iso) {
      const rows = check(
        await db
          .from('ai_usage')
          .select('created_at, model, usd')
          .gte('created_at', iso)
          .order('created_at', { ascending: false })
          .limit(5000),
        'ai_usage',
      ) as { created_at: string; model: string; usd: number | string }[];
      return rows.map((r) => ({ createdAt: r.created_at, model: r.model, usd: Number(r.usd) }));
    },
    async tickerSummary(ticker) {
      const rows = check(
        await db
          .from('ticker_daily_summary')
          .select('*')
          .eq('version', TICKER_SUMMARY_VERSION)
          .eq('ticker', ticker)
          .order('date', { ascending: false })
          .limit(1),
        'ticker_daily_summary',
      ) as AskTickerSummaryRow[];
      return rows[0] ?? null;
    },
    async holdings() {
      return check(
        await db
          .from('holdings')
          .select(
            'ticker, shares, cost_basis, opened_on, stop, targets, thesis_status, horizon, sector_etf, closed_on, updated_at',
          )
          .is('closed_on', null)
          .order('ticker'),
        'holdings',
      ) as AskHoldingRow[];
    },
    async companyResearch(ticker) {
      return check(
        await db
          .from('company_research')
          .select(
            'ticker, analyst, profile, thesis, analyst_refreshed_at, profile_refreshed_at, thesis_generated_at, fetched_at, errors',
          )
          .eq('ticker', ticker)
          .maybeSingle(),
        'company_research',
      ) as AskCompanyResearchRow | null;
    },
    async regime() {
      const rows = check(
        await db
          .from('regime_daily')
          .select('date, rule_version, label, reason, recession_level, computed_at')
          .order('date', { ascending: false })
          .limit(1),
        'regime_daily',
      ) as AskRegimeRow[];
      return rows[0] ?? null;
    },
    async breadth() {
      const rows = check(
        await db
          .from('breadth_daily')
          .select(
            'date, version, members, advancers, decliners, unchanged, above50, n50, above200, n200, new_highs, new_lows, mcclellan_oscillator, zweig_thrust, computed_at',
          )
          .order('date', { ascending: false })
          .limit(1),
        'breadth_daily',
      ) as AskBreadthRow[];
      return rows[0] ?? null;
    },
    async filings(ticker) {
      const [annual, quarterly] = await Promise.all([
        db
          .from('annual_sections')
          .select('ticker, section, period_end, filing_date, filing_url, text, fetched_at')
          .eq('ticker', ticker)
          .order('filing_date', { ascending: false })
          .limit(2),
        db
          .from('quarterly_sections')
          .select('ticker, period_end, filing_date, filing_url, text, fetched_at')
          .eq('ticker', ticker)
          .order('filing_date', { ascending: false })
          .limit(2),
      ]);
      const a = check(annual, 'annual_sections') as Omit<AskFilingSectionRow, 'kind'>[];
      const q = check(quarterly, 'quarterly_sections') as Omit<
        AskFilingSectionRow,
        'kind' | 'section'
      >[];
      return [
        ...a.map((r) => ({ ...r, kind: '10-K' as const })),
        ...q.map((r) => ({ ...r, kind: '10-Q' as const, section: 'risk_factors' })),
      ];
    },
    async alerts() {
      return check(
        await db
          .from('alerts')
          .select('created_at, kind, priority, ticker, headline, decision')
          .neq('decision', 'suppress')
          .order('created_at', { ascending: false })
          .limit(10),
        'alerts',
      ) as AskAlertRow[];
    },
    async logAsk(row: AskLogInsert) {
      check(await db.from('ask_log').insert(row), 'ask_log');
    },
  };
}

/** The `ai_usage` writer, with the service key. */
export function usageRecorder(url: string, serviceKey: string) {
  const db = createClient(url, serviceKey, NO_SESSION);
  return async (rows: AiUsageInsert[]) => {
    check(await db.from('ai_usage').insert(rows), 'ai_usage');
  };
}
