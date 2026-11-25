/**
 * Fixture recorder for 10-Q documents (manual, workflow `record-fixtures` with script `record-10q-main.ts`). For
 * NVIDIA and Rocket Lab it finds the two newest 10-Q filings in the SEC submissions API and prints each primary
 * HTML document gzip-compressed and base64-encoded (public SEC filings; bodies only, never headers).
 */
import { gzipSync } from 'node:zlib';

const ua = process.env['SEC_USER_AGENT']?.trim();
if (!ua) throw new Error('Missing environment variable SEC_USER_AGENT');
const get = async (url: string) => {
  const res = await fetch(url, { headers: { 'User-Agent': ua } });
  return { status: res.status, text: await res.text() };
};

for (const [ticker, cik] of [
  ['NVDA', 1045810],
  ['RKLB', 1819994],
] as const) {
  const sub = await get(
    `https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`,
  );
  const recent = (JSON.parse(sub.text) as { filings: { recent: Record<string, string[]> } }).filings
    .recent;
  const picks = (recent['form'] ?? [])
    .map((f, i) => ({ f, i }))
    .filter((x) => x.f === '10-Q')
    .slice(0, 2);
  for (const { i } of picks) {
    const acc = recent['accessionNumber']?.[i] ?? '';
    const doc = recent['primaryDocument']?.[i] ?? '';
    const url = `https://www.sec.gov/Archives/edgar/data/${cik}/${acc.replace(/-/g, '')}/${doc}`;
    await new Promise((r) => setTimeout(r, 300));
    const r = await get(url);
    const name = `10q-${ticker}-${acc}`;
    console.log(`${name}: status ${r.status}, ${r.text.length} chars, ${doc}`);
    console.log(`FIXTURE_BEGIN ${name}`);
    console.log(
      JSON.stringify({
        recordedAt: new Date().toISOString(),
        url,
        status: r.status,
        filingDate: recent['filingDate']?.[i],
        reportDate: recent['reportDate']?.[i],
        accession: acc,
        primaryDocument: doc,
        gzipBase64: gzipSync(Buffer.from(r.text, 'utf8')).toString('base64'),
      }),
    );
    console.log(`FIXTURE_END ${name}`);
  }
  await new Promise((r) => setTimeout(r, 300));
}

export {};
