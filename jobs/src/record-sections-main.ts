/**
 * Fixture recorder for the 10-K sections (manual, GitHub Actions, workflow `record-fixtures` with script
 * `record-sections-main.ts`). Prints the real response between FIXTURE_BEGIN and FIXTURE_END markers; the body
 * only, never keys or headers. The text is public SEC filing text, so a public log is fine.
 */
const key = process.env['MASSIVE_API_KEY']?.trim();
if (!key) throw new Error('Missing environment variable MASSIVE_API_KEY');

const url =
  'https://api.massive.com/stocks/filings/10-K/vX/sections?ticker=NVDA&section=risk_factors&limit=2&sort=period_end.desc';
const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
const text = await res.text();
console.log(`status ${res.status}, ${text.length} chars`);
console.log('FIXTURE_BEGIN sections-NVDA-risk_factors');
console.log(
  JSON.stringify({
    recordedAt: new Date().toISOString(),
    endpoint: '/stocks/filings/10-K/vX/sections',
    status: res.status,
    body: JSON.parse(text),
  }),
);
console.log('FIXTURE_END sections-NVDA-risk_factors');

export {};
