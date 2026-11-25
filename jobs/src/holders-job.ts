import {
  HOLDERS_VERSION,
  STARTING_STOCKS,
  companyKey,
  fetchCompanyTickers,
  holderList,
  issuerMatches,
  runJob,
  secDate,
  type Filer,
  type HolderList,
  type HttpClient,
  type InfoRow,
  type JobRunRecord,
  type SecConfig,
} from '@marsad/core';

/** Where the 13F data sets come from; the real one downloads from the SEC and streams with unzip. */
export interface ThirteenFSource {
  /** Data-set zip URLs from the SEC page, newest first. */
  listDataSets(): Promise<string[]>;
  /** Downloads a data set; returns something lines() can read. */
  download(url: string): Promise<string>;
  /** The lines of one file in the data set (header first). */
  lines(
    zip: string,
    file: 'INFOTABLE.tsv' | 'SUBMISSION.tsv' | 'COVERPAGE.tsv',
  ): AsyncIterable<string>;
}

export interface HoldersStore {
  /** The newest data set already stored (its file name), or null. */
  getStoredDataSet(): Promise<string | null>;
  saveHolders(
    dataSet: string,
    lists: readonly { ticker: string; list: HolderList }[],
  ): Promise<number>;
  recordRun(run: JobRunRecord): Promise<void>;
}

export interface HoldersJobDeps {
  http: HttpClient;
  sec: SecConfig;
  source: ThirteenFSource;
  store: HoldersStore;
  now: () => Date;
  tickers?: readonly string[];
}

const fileName = (url: string) => url.split('/').at(-1) ?? url;

/**
 * Institutional holders from the newest SEC Form 13F data set (holders-1, ADR 0037). Skipped when that data set is
 * already stored. Lines are matched to each watched company by issuer-name words (CUSIPs differ across share
 * classes and corporate events, and FIGIs are rarely filled in); every CUSIP used is stored with the list.
 */
export async function runHoldersJob(deps: HoldersJobDeps): Promise<JobRunRecord> {
  const { http, sec, source, store, now } = deps;
  const run = await runJob(
    'sec-13f-holders',
    async () => {
      const urls = await source.listDataSets();
      const newest = urls[0];
      if (!newest) throw new Error('No 13F data set link found on the SEC page');
      const dataSet = fileName(newest);
      if ((await store.getStoredDataSet()) === dataSet)
        return { rows: 0, skipped: `data set ${dataSet} already stored`, details: { dataSet } };
      const list = await fetchCompanyTickers(http, sec);
      if (!list.ok) throw new Error(`SEC ticker list: ${list.display}`);
      const names = new Map((list.data.value ?? []).map((c) => [c.ticker, c.name]));
      const companies = (deps.tickers ?? STARTING_STOCKS).flatMap((t) => {
        const name = names.get(t) ?? names.get(t.replace(/\./g, '-'));
        return name ? [{ ticker: t, key: companyKey(name) }] : [];
      });
      const zip = await source.download(newest);

      const rows = new Map<string, InfoRow[]>(companies.map((c) => [c.ticker, []]));
      const accessions = new Set<string>();
      let cols: string[] = [];
      let lineCount = 0;
      for await (const line of source.lines(zip, 'INFOTABLE.tsv')) {
        if (cols.length === 0) {
          cols = line.split('\t');
          continue;
        }
        lineCount++;
        const f = line.split('\t');
        const issuer = f[cols.indexOf('NAMEOFISSUER')] ?? '';
        for (const c of companies) {
          if (!issuerMatches(issuer, c.key)) continue;
          const accession = f[cols.indexOf('ACCESSION_NUMBER')] ?? '';
          accessions.add(accession);
          rows.get(c.ticker)?.push({
            accession,
            issuer,
            titleOfClass: f[cols.indexOf('TITLEOFCLASS')] ?? '',
            cusip: f[cols.indexOf('CUSIP')] ?? '',
            value: Number(f[cols.indexOf('VALUE')] ?? 0),
            shares: Number(f[cols.indexOf('SSHPRNAMT')] ?? 0),
            amountType: f[cols.indexOf('SSHPRNAMTTYPE')] ?? '',
            putCall: f[cols.indexOf('PUTCALL')] ?? '',
          });
          break;
        }
      }
      if (cols.length === 0 || !cols.includes('NAMEOFISSUER'))
        throw new Error(`INFOTABLE.tsv in ${dataSet} has no header Marsad knows`);

      const read = async (file: 'SUBMISSION.tsv' | 'COVERPAGE.tsv') => {
        const out = new Map<string, string[]>();
        let header: string[] = [];
        for await (const line of source.lines(zip, file)) {
          const f = line.split('\t');
          if (header.length === 0) header = f;
          else if (accessions.has(f[0] ?? '')) out.set(f[0] ?? '', f);
        }
        return { header, out };
      };
      const sub = await read('SUBMISSION.tsv');
      const cover = await read('COVERPAGE.tsv');
      const col = (h: string[], name: string) => h.indexOf(name);
      const filers = new Map<string, Filer>();
      for (const [acc, s] of sub.out) {
        const c = cover.out.get(acc);
        filers.set(acc, {
          accession: acc,
          cik: s[col(sub.header, 'CIK')] ?? '',
          name: c?.[col(cover.header, 'FILINGMANAGER_NAME')] ?? '',
          period: secDate(s[col(sub.header, 'PERIODOFREPORT')] ?? '') ?? '',
          filingDate: secDate(s[col(sub.header, 'FILING_DATE')] ?? '') ?? '',
          type: s[col(sub.header, 'SUBMISSIONTYPE')] ?? '',
          amendment: c?.[col(cover.header, 'ISAMENDMENT')] === 'Y',
        });
      }
      const lists = companies.flatMap((c) => {
        const l = holderList(rows.get(c.ticker) ?? [], filers);
        return l ? [{ ticker: c.ticker, list: l }] : [];
      });
      const written = await store.saveHolders(dataSet, lists);
      return {
        rows: written,
        details: {
          version: HOLDERS_VERSION,
          dataSet,
          infotableLines: lineCount,
          companies: Object.fromEntries(
            lists.map((x) => [
              x.ticker,
              {
                period: x.list.period,
                filers: x.list.filers,
                cusips: x.list.cusips.map((c) => c.cusip),
              },
            ]),
          ),
          noHolders: companies
            .filter((c) => !lists.some((x) => x.ticker === c.ticker))
            .map((c) => c.ticker),
        },
      };
    },
    () => now().getTime(),
  );
  await store.recordRun(run);
  return run;
}
