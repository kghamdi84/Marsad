import { supabase } from './supabase';

function client() {
  if (!supabase) throw new Error('not configured');
  return supabase;
}

export interface QualityRunView {
  asOf: string;
  version: string;
  fiscalYear: number;
  priceDate: string | null;
  universe: number;
  noCik: number;
  eligible: number;
  passed: number;
  excluded: Record<string, number>;
  insufficient: string | null;
}

export interface QualityRowView {
  rank: number;
  ticker: string;
  name: string;
  passes: boolean;
  quality: number;
  value: number;
  metrics: {
    grossProfitability: number;
    roa: number;
    earningsYield: number;
    bookToMarket: number;
    leverage: number;
    accruals: number;
  };
  notes: string[];
}

/** The newest screen and its passing companies (at most 20). */
export async function loadQualityScreen(): Promise<{
  run: QualityRunView | null;
  rows: QualityRowView[];
}> {
  const h = await client()
    .from('quality_screen_runs')
    .select(
      'as_of, version, fiscal_year, price_date, universe, no_cik, eligible, passed, excluded, insufficient',
    )
    .order('as_of', { ascending: false })
    .limit(1);
  if (h.error) throw new Error(`quality_screen_runs: ${h.error.message}`);
  const x = (h.data ?? [])[0] as Record<string, unknown> | undefined;
  if (!x) return { run: null, rows: [] };
  const run: QualityRunView = {
    asOf: String(x['as_of']),
    version: String(x['version']),
    fiscalYear: Number(x['fiscal_year']),
    priceDate: x['price_date'] === null ? null : String(x['price_date']),
    universe: Number(x['universe']),
    noCik: Number(x['no_cik']),
    eligible: Number(x['eligible']),
    passed: Number(x['passed']),
    excluded: (x['excluded'] ?? {}) as Record<string, number>,
    insufficient: x['insufficient'] === null ? null : String(x['insufficient']),
  };
  const r = await client()
    .from('quality_screen')
    .select('rank, ticker, name, passes, quality, value, metrics, notes')
    .eq('as_of', run.asOf)
    .eq('passes', true)
    .order('rank')
    .limit(20);
  if (r.error) throw new Error(`quality_screen: ${r.error.message}`);
  const rows = ((r.data ?? []) as Record<string, unknown>[]).map((y) => ({
    rank: Number(y['rank']),
    ticker: String(y['ticker']),
    name: String(y['name']),
    passes: y['passes'] === true,
    quality: Number(y['quality']),
    value: Number(y['value']),
    metrics: y['metrics'] as QualityRowView['metrics'],
    notes: (y['notes'] ?? []) as string[],
  }));
  return { run, rows };
}
