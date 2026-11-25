import { supabase } from './supabase';

function client() {
  if (!supabase) throw new Error('not configured');
  return supabase;
}

export interface EtfReportView {
  etf: string;
  reportDate: string;
  accession: string;
  version: string;
  holdings: number;
  matched: number;
}

export interface EtfHoldingView {
  name: string;
  cusip: string | null;
  ticker: string | null;
  weight: number;
}

/** The newest stored N-PORT report of each covered fund and its holdings. Reads go through row-level security. */
export async function loadEtfHoldings(): Promise<{
  reports: EtfReportView[];
  holdings: Record<string, EtfHoldingView[]>;
}> {
  const r = await client()
    .from('etf_reports')
    .select('etf, report_date, accession, version, holdings, matched')
    .order('report_date', { ascending: false });
  if (r.error) throw new Error(`etf_reports: ${r.error.message}`);
  const reports: EtfReportView[] = [];
  for (const x of (r.data ?? []) as Record<string, unknown>[]) {
    const etf = String(x['etf']);
    if (reports.some((y) => y.etf === etf)) continue;
    reports.push({
      etf,
      reportDate: String(x['report_date']),
      accession: String(x['accession']),
      version: String(x['version']),
      holdings: Number(x['holdings']),
      matched: Number(x['matched']),
    });
  }
  const holdings: Record<string, EtfHoldingView[]> = {};
  await Promise.all(
    reports.map(async (rep) => {
      const h = await client()
        .from('etf_holdings')
        .select('name, cusip, ticker, weight')
        .eq('etf', rep.etf)
        .eq('report_date', rep.reportDate)
        .order('rank', { ascending: true })
        .limit(5000);
      if (h.error) throw new Error(`etf_holdings ${rep.etf}: ${h.error.message}`);
      holdings[rep.etf] = ((h.data ?? []) as Record<string, unknown>[]).map((y) => ({
        name: String(y['name']),
        cusip: y['cusip'] === null ? null : String(y['cusip']),
        ticker: y['ticker'] === null ? null : String(y['ticker']),
        weight: Number(y['weight']),
      }));
    }),
  );
  reports.sort((a, b) => a.etf.localeCompare(b.etf));
  return { reports, holdings };
}
