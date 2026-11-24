/**
 * Fixture recorder for insider Forms 3 and 5 (manual, GitHub Actions, workflow `record-fixtures` with script
 * `record-holdings-main.ts`). Finds Form 3, 3/A, 5 and 5/A filings in the recent filings of the tracked stocks,
 * prints a one-line structure summary of each and the XML of the first few of each kind between FIXTURE_BEGIN and
 * FIXTURE_END markers. Documents are public SEC filings; only bodies are printed, never headers.
 */
import { STARTING_STOCKS } from '@marsad/core';

const ua = process.env['SEC_USER_AGENT']?.trim();
if (!ua) throw new Error('Missing environment variable SEC_USER_AGENT');
const headers = { 'User-Agent': ua, Accept: '*/*' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(url: string) {
  const res = await fetch(url, { headers });
  await sleep(250);
  return { status: res.status, text: await res.text() };
}

const tickers = await get('https://www.sec.gov/files/company_tickers.json');
const byTicker = new Map<string, string>();
for (const row of Object.values(
  JSON.parse(tickers.text) as Record<string, { cik_str: number; ticker: string }>,
))
  byTicker.set(row.ticker, String(row.cik_str).padStart(10, '0'));

interface Found {
  ticker: string;
  cik: string;
  form: string;
  accession: string;
  filingDate: string;
  doc: string;
}
const found: Found[] = [];
for (const t of STARTING_STOCKS) {
  const cik = byTicker.get(t);
  if (!cik) continue;
  const s = JSON.parse((await get(`https://data.sec.gov/submissions/CIK${cik}.json`)).text) as {
    filings: { recent: Record<string, string[]> };
  };
  const r = s.filings.recent;
  for (let i = 0; i < (r['form']?.length ?? 0); i++) {
    const form = r['form']?.[i] ?? '';
    const doc = r['primaryDocument']?.[i] ?? '';
    if (['3', '3/A', '5', '5/A'].includes(form) && /\.xml$/i.test(doc))
      found.push({
        ticker: t,
        cik,
        form,
        accession: r['accessionNumber']?.[i] ?? '',
        filingDate: r['filingDate']?.[i] ?? '',
        doc,
      });
  }
}
console.log(
  `found ${found.length} Form 3/5 filings: ${JSON.stringify(
    found.reduce<Record<string, number>>((m, f) => ({ ...m, [f.form]: (m[f.form] ?? 0) + 1 }), {}),
  )}`,
);

const count = (xml: string, tag: string) => (xml.match(new RegExp(`<${tag}>`, 'g')) ?? []).length;
const taken: Record<string, number> = {};
for (const f of found.sort((a, b) => b.filingDate.localeCompare(a.filingDate))) {
  if ((taken[f.form] ?? 0) >= 4) continue;
  const path = `/Archives/edgar/data/${Number(f.cik)}/${f.accession.replace(/-/g, '')}/${f.doc.replace(/^xsl[^/]*\//, '')}`;
  const x = await get(`https://www.sec.gov${path}`);
  taken[f.form] = (taken[f.form] ?? 0) + 1;
  console.log(
    `SUMMARY ${f.ticker} form ${f.form} ${f.accession} filed ${f.filingDate} status ${x.status} bytes ${x.text.length} ` +
      `nonDerivativeHolding ${count(x.text, 'nonDerivativeHolding')} derivativeHolding ${count(x.text, 'derivativeHolding')} ` +
      `nonDerivativeTransaction ${count(x.text, 'nonDerivativeTransaction')} derivativeTransaction ${count(x.text, 'derivativeTransaction')} ` +
      `owners ${count(x.text, 'reportingOwner')}`,
  );
  const name = `sec-form${f.form.replace('/', '')}-${f.accession}`;
  console.log(`FIXTURE_BEGIN ${name}`);
  console.log(
    JSON.stringify({
      recordedAt: new Date().toISOString(),
      source: 'sec_edgar',
      endpoint: path,
      status: x.status,
      body: x.text,
    }),
  );
  console.log(`FIXTURE_END ${name}`);
}

export {};
