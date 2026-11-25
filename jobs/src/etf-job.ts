import {
  ETF_VERSION,
  fetchCompanyTickers,
  fetchRecentFilings,
  matchTickers,
  parseNport,
  runJob,
  type HttpClient,
  type JobRunRecord,
  type NportReport,
  type SecConfig,
} from '@marsad/core';

/** Funds covered: single-fund trusts, whose newest NPORT-P is the fund's own. Multi-fund trusts (IWM) are not. */
export const ETF_TRUSTS = [
  { etf: 'SPY', cik: 884394 },
  { etf: 'QQQ', cik: 1067839 },
  { etf: 'DIA', cik: 1041130 },
] as const;

export interface EtfStore {
  getStoredAccessions(): Promise<Set<string>>;
  saveEtfReport(
    etf: string,
    accession: string,
    report: NportReport,
    tickers: readonly (string | null)[],
  ): Promise<number>;
  recordRun(run: JobRunRecord): Promise<void>;
}

export interface EtfJobDeps {
  http: HttpClient;
  sec: SecConfig;
  store: EtfStore;
  now: () => Date;
}

/**
 * The newest public N-PORT holdings of SPY, QQQ and DIA (etf-1, ADR 0038), each report downloaded once. Holdings are
 * matched to tickers by company name against the SEC ticker list; names shared by share classes stay unmatched.
 */
export async function runEtfJob(deps: EtfJobDeps): Promise<JobRunRecord> {
  const { http, sec, store, now } = deps;
  const run = await runJob(
    'sec-etf-holdings',
    async () => {
      const have = await store.getStoredAccessions();
      const list = await fetchCompanyTickers(http, sec);
      if (!list.ok) throw new Error(`SEC ticker list: ${list.display}`);
      const companies = (list.data.value ?? []).map((c) => ({ ticker: c.ticker, name: c.name }));
      const out: Record<string, unknown> = {};
      let rows = 0;
      for (const t of ETF_TRUSTS) {
        const f = await fetchRecentFilings(http, sec, t.cik);
        if (!f.ok) throw new Error(`${t.etf} filings: ${f.display}`);
        const nport = (f.data.value ?? []).find((x) => x.form === 'NPORT-P');
        if (!nport || !nport.primaryDocument) {
          out[t.etf] = 'no NPORT-P in recent filings';
          continue;
        }
        if (have.has(nport.accession)) {
          out[t.etf] = `already stored (${nport.accession})`;
          continue;
        }
        const doc = nport.primaryDocument.replace(/^xsl[^/]*\//, '');
        const url = `https://www.sec.gov/Archives/edgar/data/${t.cik}/${nport.accession.replace(/-/g, '')}/${doc}`;
        const res = await http.get(url, { headers: { 'User-Agent': sec.userAgent } });
        if (!res.ok) throw new Error(`${t.etf} N-PORT download: ${res.kind}`);
        const report = parseNport(res.body);
        const tickers = matchTickers(report.holdings, companies);
        rows += await store.saveEtfReport(t.etf, nport.accession, report, tickers);
        out[t.etf] = {
          reportDate: report.reportDate,
          holdings: report.holdings.length,
          matched: tickers.filter((x) => x !== null).length,
        };
      }
      return {
        rows,
        details: { version: ETF_VERSION, funds: out, notCovered: ['IWM (multi-fund trust)'] },
      };
    },
    () => now().getTime(),
  );
  await store.recordRun(run);
  return run;
}
