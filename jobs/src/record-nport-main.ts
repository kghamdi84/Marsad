/**
 * Fixture recorder for N-PORT holdings (manual, workflow `record-fixtures` with script `record-nport-main.ts`). For
 * the single-fund trusts behind SPY, QQQ and DIA it finds the newest public NPORT-P filing in the SEC submissions
 * API and prints its primary XML document gzip-compressed and base64-encoded. Public SEC data; bodies only.
 */
import { gzipSync } from 'node:zlib';

const ua = process.env['SEC_USER_AGENT']?.trim();
if (!ua) throw new Error('Missing environment variable SEC_USER_AGENT');
const get = async (url: string) => {
  const res = await fetch(url, { headers: { 'User-Agent': ua } });
  return { status: res.status, text: await res.text() };
};

for (const [etf, cik] of [
  ['SPY', 884394],
  ['QQQ', 1067839],
  ['DIA', 1041130],
] as const) {
  const sub = await get(
    `https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`,
  );
  const recent = (JSON.parse(sub.text) as { filings: { recent: Record<string, string[]> } }).filings
    .recent;
  const i = (recent['form'] ?? []).findIndex((f) => f === 'NPORT-P');
  if (i < 0) {
    console.log(`${etf}: no NPORT-P in recent filings`);
    continue;
  }
  const acc = recent['accessionNumber']?.[i] ?? '';
  const doc = recent['primaryDocument']?.[i] ?? '';
  // The primary document is often a rendered xsl path; the XML sits next to it.
  const xml = doc.replace(/^xsl[^/]*\//, '');
  const url = `https://www.sec.gov/Archives/edgar/data/${cik}/${acc.replace(/-/g, '')}/${xml}`;
  await new Promise((r) => setTimeout(r, 300));
  const r = await get(url);
  const name = `nport-${etf}-${acc}`;
  console.log(`${name}: status ${r.status}, ${r.text.length} chars, ${doc}`);
  console.log(`FIXTURE_BEGIN ${name}`);
  console.log(
    JSON.stringify({
      recordedAt: new Date().toISOString(),
      etf,
      cik,
      url,
      status: r.status,
      filingDate: recent['filingDate']?.[i],
      reportDate: recent['reportDate']?.[i],
      accession: acc,
      gzipBase64: gzipSync(Buffer.from(r.text, 'utf8')).toString('base64'),
    }),
  );
  console.log(`FIXTURE_END ${name}`);
  await new Promise((r2) => setTimeout(r2, 300));
}

export {};
