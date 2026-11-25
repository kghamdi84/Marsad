/**
 * Fixture recorder for the 10-K sections (manual, GitHub Actions, workflow `record-fixtures` with script
 * `record-sections-main.ts`). Prints the real responses between FIXTURE_BEGIN and FIXTURE_END markers; the body
 * only, never keys or headers. The text is public SEC filing text, so a public log is fine. Records NVIDIA's two
 * newest risk-factor sections and its newest business section (Item 1).
 */
const key = process.env['MASSIVE_API_KEY']?.trim();
if (!key) throw new Error('Missing environment variable MASSIVE_API_KEY');

for (const [section, limit] of [
  ['risk_factors', 2],
  ['business', 1],
] as const) {
  const url = `https://api.massive.com/stocks/filings/10-K/vX/sections?ticker=NVDA&section=${section}&limit=${limit}&sort=period_end.desc`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  const text = await res.text();
  const name = `sections-NVDA-${section}`;
  console.log(`${name}: status ${res.status}, ${text.length} chars`);
  console.log(`FIXTURE_BEGIN ${name}`);
  console.log(
    JSON.stringify({
      recordedAt: new Date().toISOString(),
      endpoint: '/stocks/filings/10-K/vX/sections',
      status: res.status,
      body: JSON.parse(text),
    }),
  );
  console.log(`FIXTURE_END ${name}`);
  // The plan allows about 5 calls a minute.
  await new Promise((r) => setTimeout(r, 13_000));
}

export {};
