import {
  STARTING_STOCKS,
  TENQ_VERSION,
  extractQuarterlyRiskFactors,
  htmlToText,
  runJob,
  type HttpClient,
  type JobRunRecord,
  type SecConfig,
} from '@marsad/core';

export interface TenQFiling {
  accession: string;
  cik: string;
  ticker: string;
  filingDate: string;
  periodEnd: string | null;
  primaryDocument: string;
}

export interface TenQStore {
  /** The two newest stored 10-Q filings of each ticker (from the SEC filings job), newest first. */
  getRecentTenQ(tickers: readonly string[]): Promise<TenQFiling[]>;
  /** Accessions already stored, so a filing is downloaded once. */
  getStoredQuarterly(accessions: readonly string[]): Promise<Set<string>>;
  saveQuarterly(
    rows: readonly (TenQFiling & { url: string; text: string; noMaterialChanges: boolean })[],
  ): Promise<number>;
  recordRun(run: JobRunRecord): Promise<void>;
}

export interface TenQJobDeps {
  http: HttpClient;
  sec: SecConfig;
  store: TenQStore;
  now: () => Date;
  tickers?: readonly string[];
}

/**
 * Stores Part II, Item 1A of each stock's two newest 10-Q filings (tenq-1, ADR 0036), each downloaded once from SEC
 * archives. A filing whose section cannot be found is named in the run details, never stored as empty; a failed
 * download fails the run.
 */
export async function runTenQJob(deps: TenQJobDeps): Promise<JobRunRecord> {
  const { http, sec, store, now } = deps;
  const run = await runJob(
    'sec-10q-sections',
    async () => {
      const filings = await store.getRecentTenQ(deps.tickers ?? STARTING_STOCKS);
      const have = await store.getStoredQuarterly(filings.map((f) => f.accession));
      const unreadable: string[] = [];
      const failed: string[] = [];
      const rows = [];
      for (const f of filings.filter((x) => !have.has(x.accession))) {
        if (!/^[\w.-]+\.htm[l]?$/i.test(f.primaryDocument)) {
          unreadable.push(`${f.ticker} ${f.accession}: not an HTML document`);
          continue;
        }
        const url = `https://www.sec.gov/Archives/edgar/data/${Number(f.cik)}/${f.accession.replace(/-/g, '')}/${f.primaryDocument}`;
        const res = await http.get(url, { headers: { 'User-Agent': sec.userAgent } });
        if (!res.ok) {
          failed.push(`${f.ticker} ${f.accession}: ${res.kind}`);
          continue;
        }
        const section = extractQuarterlyRiskFactors(htmlToText(res.body));
        if (!section) {
          unreadable.push(`${f.ticker} ${f.accession}: Part II, Item 1A not found`);
          continue;
        }
        rows.push({ ...f, url, text: section.text, noMaterialChanges: section.noMaterialChanges });
      }
      const written = await store.saveQuarterly(rows);
      if (failed.length > 0)
        throw new Error(`10-Q downloads failed: ${failed.join('; ')}`.slice(0, 480));
      return {
        rows: written,
        details: {
          version: TENQ_VERSION,
          filings: filings.length,
          alreadyStored: have.size,
          stored: written,
          ...(unreadable.length ? { unreadable } : {}),
        },
      };
    },
    () => now().getTime(),
  );
  await store.recordRun(run);
  return run;
}
