import {
  ETF_VERSION,
  OPENFIGI_VERSION,
  fetchCompanyTickers,
  fetchRecentFilings,
  matchTickers,
  parseNport,
  runJob,
  type FigiMatch,
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
    figis: readonly (string | null)[],
  ): Promise<number>;
  recordRun(run: JobRunRecord): Promise<void>;
}

export interface EtfJobDeps {
  http: HttpClient;
  sec: SecConfig;
  store: EtfStore;
  now: () => Date;
  /**
   * Identifier to ticker and composite FIGI (OpenFIGI, openfigi-2), keyed by the CUSIP or ISIN asked for. Absent or
   * failing: names only, and the run says why.
   */
  figi?: (ids: {
    cusips: readonly string[];
    isins: readonly string[];
  }) => Promise<Map<string, FigiMatch>>;
}

/**
 * The newest public N-PORT holdings of SPY, QQQ and DIA (ADR 0038), each report downloaded once per formula version.
 * etf-3 matches holdings to a ticker and composite FIGI through OpenFIGI, by CUSIP and, for holdings without one, by
 * ISIN; by company name against the SEC ticker list only where OpenFIGI has no single US ticker (no FIGI then);
 * names shared by share classes stay unmatched.
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
        let byId = new Map<string, FigiMatch>();
        let figiNote: string | null = deps.figi ? null : 'OpenFIGI not configured';
        if (deps.figi)
          try {
            byId = await deps.figi({
              cusips: equity.flatMap((h) => (h.cusip ? [h.cusip] : [])),
              isins: equity.flatMap((h) => (!h.cusip && h.isin ? [h.isin] : [])),
            });
          } catch (e) {
            figiNote = `OpenFIGI failed, names only: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`;
          }
        const viaFigi = report.holdings.map((h) =>
          h.assetCat !== 'EC'
            ? null
            : ((h.cusip ? byId.get(h.cusip) : undefined) ??
              (h.isin ? byId.get(h.isin) : undefined) ??
              null),
        );
        const byName = matchTickers(report.holdings, companies);
        const tickers = report.holdings.map((_, i) => viaFigi[i]?.ticker ?? byName[i] ?? null);
        const figis = viaFigi.map((m) => m?.figi ?? null);
        rows += await store.saveEtfReport(t.etf, nport.accession, report, tickers, figis);
        const viaCusip = report.holdings.filter(
          (h, i) => viaFigi[i] !== null && h.cusip !== null && byId.has(h.cusip),
        ).length;
        const viaIsin = viaFigi.filter((m) => m !== null).length - viaCusip;
        const matched = tickers.filter((x) => x !== null).length;
        out[t.etf] = {
          reportDate: report.reportDate,
          holdings: report.holdings.length,
          equity: equity.length,
          matched,
          byCusip: viaCusip,
          byIsin: viaIsin,
          byName: matched - viaCusip - viaIsin,
          withFigi: figis.filter((x) => x !== null).length,
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
