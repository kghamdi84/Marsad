import {
  ETF_VERSION,
  OPENFIGI_VERSION,
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
  /** Each stored report's accession with the formula version it was matched under. */
  getStoredAccessions(): Promise<Map<string, string>>;
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
  /** CUSIP to ticker (OpenFIGI, openfigi-1). Absent or failing: names only, and the run says why. */
  figi?: (cusips: readonly string[]) => Promise<Map<string, string>>;
}

/**
 * The newest public N-PORT holdings of SPY, QQQ and DIA (ADR 0038), each report downloaded once per formula version.
 * etf-2 matches holdings to tickers by CUSIP through OpenFIGI first and by company name against the SEC ticker list
 * only where OpenFIGI has no single US ticker; names shared by share classes stay unmatched.
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
        if (have.get(nport.accession) === ETF_VERSION) {
          out[t.etf] = `already stored (${nport.accession})`;
          continue;
        }
        const doc = nport.primaryDocument.replace(/^xsl[^/]*\//, '');
        const url = `https://www.sec.gov/Archives/edgar/data/${t.cik}/${nport.accession.replace(/-/g, '')}/${doc}`;
        const res = await http.get(url, { headers: { 'User-Agent': sec.userAgent } });
        if (!res.ok) throw new Error(`${t.etf} N-PORT download: ${res.kind}`);
        const report = parseNport(res.body);
        const equity = report.holdings.filter((h) => h.assetCat === 'EC');
        let byCusip = new Map<string, string>();
        let figiNote: string | null = deps.figi ? null : 'OpenFIGI not configured';
        if (deps.figi)
          try {
            byCusip = await deps.figi(equity.flatMap((h) => (h.cusip ? [h.cusip] : [])));
          } catch (e) {
            figiNote = `OpenFIGI failed, names only: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`;
          }
        const tickers = matchTickers(report.holdings, companies, byCusip);
        rows += await store.saveEtfReport(t.etf, nport.accession, report, tickers);
        const viaCusip = report.holdings.filter(
          (h, i) => tickers[i] !== null && h.cusip !== null && byCusip.has(h.cusip),
        ).length;
        const matched = tickers.filter((x) => x !== null).length;
        out[t.etf] = {
          reportDate: report.reportDate,
          holdings: report.holdings.length,
          equity: equity.length,
          matched,
          byCusip: viaCusip,
          byName: matched - viaCusip,
          unmatched: equity.length - matched,
          ...(figiNote ? { figi: figiNote } : {}),
        };
      }
      return {
        rows,
        details: {
          version: ETF_VERSION,
          figiVersion: OPENFIGI_VERSION,
          funds: out,
          notCovered: ['IWM (multi-fund trust)'],
        },
      };
    },
    () => now().getTime(),
  );
  await store.recordRun(run);
  return run;
}
