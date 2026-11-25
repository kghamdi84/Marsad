/**
 * Fixture recorder for the SEC Form 13F data sets (manual, workflow `record-fixtures` with script
 * `record-13f-main.ts`). Lists the data-set page's zip links, downloads the newest one, prints its file list and a
 * real sample: the INFOTABLE rows for NVIDIA and Rocket Lab and the matching SUBMISSION and COVERPAGE rows.
 * Public SEC data; bodies only. Uses the runner's unzip.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const ua = process.env['SEC_USER_AGENT']?.trim();
if (!ua) throw new Error('Missing environment variable SEC_USER_AGENT');

const pages = [
  'https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets',
  'https://www.sec.gov/dera/data/form-13f-data-sets',
];
let links: string[] = [];
for (const p of pages) {
  const res = await fetch(p, { headers: { 'User-Agent': ua } });
  const html = await res.text();
  console.log(`${p}: status ${res.status}, ${html.length} chars`);
  links = [...new Set([...html.matchAll(/href="([^"]+\.zip)"/gi)].map((m) => m[1] ?? ''))];
  if (links.length > 0) break;
}
console.log(`LINKS ${JSON.stringify(links.slice(0, 12))}`);
const first = links[0];
if (!first) throw new Error('no zip links found');
const url = first.startsWith('http') ? first : `https://www.sec.gov${first}`;
const zip = await fetch(url, { headers: { 'User-Agent': ua } });
const buf = Buffer.from(await zip.arrayBuffer());
console.log(`ZIP ${url}: status ${zip.status}, ${buf.length} bytes`);
writeFileSync('/tmp/13f.zip', buf);
console.log(execFileSync('unzip', ['-l', '/tmp/13f.zip']).toString());

const read = (file: string) =>
  execFileSync('unzip', ['-p', '/tmp/13f.zip', file], { maxBuffer: 4 * 1024 * 1024 * 1024 })
    .toString('utf8')
    .split('\n');
const info = read('INFOTABLE.tsv');
const header = info[0] ?? '';
const cols = header.split('\t');
const issuer = cols.indexOf('NAMEOFISSUER');
const rows = info.filter(
  (l, i) => i > 0 && /^(NVIDIA CORP|ROCKET LAB)/i.test(l.split('\t')[issuer] ?? ''),
);
const sample = rows.slice(0, 300);
const acc = new Set(sample.map((l) => l.split('\t')[0]));
const pick = (file: string) => {
  const lines = read(file);
  return [lines[0], ...lines.slice(1).filter((l) => acc.has(l.split('\t')[0]))];
};
console.log('FIXTURE_BEGIN 13f-sample');
console.log(
  JSON.stringify({
    recordedAt: new Date().toISOString(),
    url,
    infotableRows: info.length - 1,
    matchedRows: rows.length,
    infotable: [header, ...sample],
    submission: pick('SUBMISSION.tsv'),
    coverpage: pick('COVERPAGE.tsv'),
  }),
);
console.log('FIXTURE_END 13f-sample');

export {};
