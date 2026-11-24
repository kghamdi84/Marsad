/**
 * Fixture recorder (manual, run by GitHub Actions). Calls a few live endpoints once and prints each
 * response, trimmed to a small size, between FIXTURE_BEGIN and FIXTURE_END markers so it can be copied
 * into `fixtures/`. It prints only response bodies, never headers or keys; GitHub also masks secrets in
 * logs. The workflow logs of a public repository are public, so only public data may be printed here.
 */
function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

const fredKey = need('FRED_API_KEY');
const secUa = need('SEC_USER_AGENT');
const massiveKey = need('MASSIVE_API_KEY');

function emit(name: string, meta: Record<string, unknown>, body: unknown): void {
  const text = JSON.stringify({ recordedAt: new Date().toISOString(), ...meta, body });
  console.log(`FIXTURE_BEGIN ${name}`);
  console.log(text.split(fredKey).join('REDACTED'));
  console.log(`FIXTURE_END ${name}`);
}

async function getJson(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, { headers });
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text.slice(0, 500) };
  }
}

// FRED: DGS10 around Veterans Day, when the bond market is closed and FRED publishes "." for the day.
{
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=DGS10&observation_start=2026-11-05&observation_end=2026-11-20&file_type=json&api_key=${encodeURIComponent(fredKey)}`;
  const r = await getJson(url);
  emit(
    'fred-DGS10-2026-11',
    { source: 'fred', endpoint: '/fred/series/observations?series_id=DGS10', status: r.status },
    r.body,
  );
}

// SEC: submissions for NVIDIA, trimmed to the 8 newest filings (arrays in `filings.recent` are parallel).
{
  const r = await getJson('https://data.sec.gov/submissions/CIK0001045810.json', {
    'User-Agent': secUa,
    Accept: 'application/json',
  });
  const b = r.body as {
    filings?: { recent?: Record<string, unknown[]>; files?: unknown[] };
    [k: string]: unknown;
  };
  const recent = b.filings?.recent;
  if (recent) for (const k of Object.keys(recent)) recent[k] = (recent[k] ?? []).slice(0, 8);
  const trimmed = {
    cik: b['cik'],
    entityType: b['entityType'],
    name: b['name'],
    tickers: b['tickers'],
    exchanges: b['exchanges'],
    filings: { recent, files: (b.filings?.files ?? []).length },
  };
  emit(
    'sec-submissions-NVDA',
    {
      source: 'sec_edgar',
      endpoint: '/submissions/CIK{cik}.json',
      status: r.status,
      trimmedTo: '8 newest filings; older-filing file list replaced by its length',
    },
    trimmed,
  );
}

// SEC: ticker to CIK map, trimmed to NVDA, AAPL and the first 2 entries.
{
  const r = await getJson('https://www.sec.gov/files/company_tickers.json', {
    'User-Agent': secUa,
    Accept: 'application/json',
  });
  const all = Object.entries(r.body as Record<string, { ticker?: string }>);
  const keep = all.filter(([i, v]) => Number(i) < 2 || v.ticker === 'NVDA' || v.ticker === 'AAPL');
  emit(
    'sec-company-tickers',
    {
      source: 'sec_edgar',
      endpoint: '/files/company_tickers.json',
      status: r.status,
      trimmedTo: `first 2 entries, NVDA and AAPL (of ${all.length})`,
    },
    Object.fromEntries(keep),
  );
}

// Massive: SPY daily bars for a week and the full 1-minute day of 2026-11-18, untrimmed (the VWAP check).
for (const [name, path] of [
  [
    'massive-aggs-SPY-1d-2026-11-16-to-20',
    '/v2/aggs/ticker/SPY/range/1/day/2026-11-16/2026-11-20?adjusted=true&sort=asc',
  ],
  [
    'massive-aggs-SPY-1m-2026-11-18',
    '/v2/aggs/ticker/SPY/range/1/minute/2026-11-18/2026-11-18?adjusted=true&sort=asc&limit=50000',
  ],
] as const) {
  const r = await getJson(`https://api.massive.com${path}`, {
    Authorization: `Bearer ${massiveKey}`,
  });
  emit(name, { source: 'massive', endpoint: path, status: r.status }, r.body);
}

// Massive: a request the free plan is not entitled to, to record the real error body.
for (const path of [
  '/v3/snapshot/options/AAPL',
  '/v2/snapshot/locale/us/markets/stocks/tickers/AAPL',
]) {
  const r = await getJson(`https://api.massive.com${path}`, {
    Authorization: `Bearer ${massiveKey}`,
  });
  emit(
    `massive-entitlement-${path.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}`,
    { source: 'massive', endpoint: path, status: r.status },
    r.body,
  );
}

export {};
