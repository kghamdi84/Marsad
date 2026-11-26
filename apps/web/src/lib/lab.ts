import { supabase } from './supabase';

function client() {
  if (!supabase) throw new Error('not configured');
  return supabase;
}

export interface LabRule {
  id: string;
  version: number;
  status: string;
}

export interface LabRun {
  ruleId: string;
  version: number;
  createdAt: string;
  params: {
    tickers?: string[];
    costs?: { commissionBps: number; slippageBps: number; fxBps: number };
  };
  report: {
    trades?: number;
    gate?: { ok: boolean; reason: string };
    outOfSample?: {
      stats: { n: number; winRate: number | null; maxDrawdown: number | null; sufficient: boolean };
      expectancy: { value: number | null; ci90: { low: number; high: number } | null };
      benchmark: { ticker: string; ret: number } | null;
      monteCarlo: { worst5: number } | null;
      /** Growth of 1 by exit date; only in reports stored from backtest runs after 2026-11-26. */
      equity?: { date: string; equity: number }[];
    };
  };
}

/** The newest version of each rule and the newest run of each. Every read goes through row-level security. */
export async function loadLab(): Promise<{ rules: LabRule[]; runs: LabRun[] }> {
  const [r, b] = await Promise.all([
    client().from('rules').select('id, version, status').order('version', { ascending: false }),
    client()
      .from('backtest_runs')
      .select('rule_id, version, created_at, params, report')
      .order('created_at', { ascending: false })
      .limit(50),
  ]);
  if (r.error) throw new Error(`rules: ${r.error.message}`);
  if (b.error) throw new Error(`backtest_runs: ${b.error.message}`);
  const rules: LabRule[] = [];
  for (const x of (r.data ?? []) as Record<string, unknown>[])
    if (!rules.some((y) => y.id === x['id']))
      rules.push({
        id: String(x['id']),
        version: Number(x['version']),
        status: String(x['status']),
      });
  const runs: LabRun[] = [];
  for (const x of (b.data ?? []) as Record<string, unknown>[])
    if (!runs.some((y) => y.ruleId === x['rule_id']))
      runs.push({
        ruleId: String(x['rule_id']),
        version: Number(x['version']),
        createdAt: String(x['created_at']),
        params: (x['params'] ?? {}) as LabRun['params'],
        report: (x['report'] ?? {}) as LabRun['report'],
      });
  return { rules, runs };
}
