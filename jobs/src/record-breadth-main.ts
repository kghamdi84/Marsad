/**
 * Fixture recorder for the breadth job (manual, GitHub Actions, workflow `record-fixtures` with script
 * `record-breadth-main.ts`). Records, with the project key: one grouped daily (unadjusted) trimmed to a few tickers
 * plus its full counts, a page of all-market splits, and a trimmed page of common-stock and ETF tickers as of a date.
 * Bodies only, never keys or headers; all public market data.
 */
const key = process.env['MASSIVE_API_KEY']?.trim();
if (!key) throw new Error('Missing environment variable MASSIVE_API_KEY');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function get(path: string) {
  const res = await fetch(`https://api.massive.com${path}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const text = await res.text();
  await sleep(13_000); // about 5 calls a minute
  return { status: res.status, json: JSON.parse(text) as Record<string, unknown> };
}
function emit(name: string, endpoint: string, status: number, body: unknown) {
  console.log(`FIXTURE_BEGIN ${name}`);
  console.log(
    JSON.stringify({
      recordedAt: new Date().toISOString(),
      source: 'massive',
      endpoint,
      status,
      body,
    }),
  );
  console.log(`FIXTURE_END ${name}`);
}
const KEEP = new Set([
  'AAPL',
  'NVDA',
  'SPY',
  'QQQ',
  'TSLA',
  'RKLB',
  'SOFI',
  'BRK.B',
  'TQQQ',
  'SOXL',
  'MSFT',
  'AMZN',
]);

const g = await get('/v2/aggs/grouped/locale/us/market/stocks/2026-11-24?adjusted=false');
const rows = (g.json['results'] as { T: string; c: number; v: number }[] | undefined) ?? [];
const dv = rows.map((r) => r.c * r.v).sort((a, b) => b - a);
console.log(
  `grouped 2026-11-24: status ${g.status}, ${rows.length} rows, adjusted=${String(g.json['adjusted'])}; dollar volume of the 1000th: ${dv[999]}; tickers with at least $100k: ${dv.filter((x) => x >= 100_000).length}`,
);
emit(
  'massive-grouped-2026-11-24-trimmed',
  '/v2/aggs/grouped/locale/us/market/stocks/2026-11-24?adjusted=false',
  g.status,
  {
    ...g.json,
    results: rows.filter((r) => KEEP.has(r.T)),
    _trimmed: `kept ${KEEP.size} of ${rows.length} rows`,
  },
);

const s = await get(
  '/stocks/v1/splits?execution_date.gte=2026-10-01&execution_date.lte=2026-11-24&limit=5000&sort=execution_date.asc',
);
const sr = (s.json['results'] as unknown[] | undefined) ?? [];
console.log(
  `splits since 2026-10-01: status ${s.status}, ${sr.length} rows, next_url ${s.json['next_url'] ? 'yes' : 'no'}`,
);
emit(
  'massive-splits-2026-10-01-to-11-24',
  '/stocks/v1/splits?execution_date.gte=2026-10-01&execution_date.lte=2026-11-24&limit=5000&sort=execution_date.asc',
  s.status,
  { ...s.json, results: sr.slice(0, 40), _trimmed: `kept 40 of ${sr.length}` },
);

for (const type of ['CS', 'ETF']) {
  const t = await get(
    `/v3/reference/tickers?market=stocks&type=${type}&date=2025-06-02&active=true&limit=1000`,
  );
  const tr = (t.json['results'] as unknown[] | undefined) ?? [];
  const next =
    typeof t.json['next_url'] === 'string'
      ? (t.json['next_url'] as string).replace(/apiKey=[^&]*/g, 'apiKey=REDACTED')
      : null;
  console.log(
    `tickers ${type} as of 2025-06-02: status ${t.status}, ${tr.length} rows on page 1, next_url ${next ? 'yes' : 'no'}`,
  );
  emit(
    `massive-tickers-${type}-2025-06-02-page1-trimmed`,
    `/v3/reference/tickers?market=stocks&type=${type}&date=2025-06-02&active=true&limit=1000`,
    t.status,
    {
      ...t.json,
      next_url: next,
      results: tr.slice(0, 15),
      _trimmed: `kept 15 of ${tr.length} on page 1`,
    },
  );
}
export {};
