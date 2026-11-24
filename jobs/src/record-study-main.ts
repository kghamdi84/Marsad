/**
 * Fixture recorder for the Study module (manual, GitHub Actions, workflow `record-fixtures` with script
 * `record-study-main.ts`). Prints trimmed real responses between FIXTURE_BEGIN and FIXTURE_END markers; bodies
 * only, never keys or headers. Logs of a public repository are public, so only public data is recorded.
 */
function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

const secUa = need('SEC_USER_AGENT');
const massiveKey = need('MASSIVE_API_KEY');

function emit(name: string, meta: Record<string, unknown>, body: unknown): void {
  console.log(`FIXTURE_BEGIN ${name}`);
  console.log(JSON.stringify({ recordedAt: new Date().toISOString(), ...meta, body }));
  console.log(`FIXTURE_END ${name}`);
}

async function get(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers });
  return { status: res.status, text: await res.text() };
}
const sec = { 'User-Agent': secUa, Accept: '*/*' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// SEC company facts for NVIDIA, trimmed to the concepts the Study page uses and their 16 newest entries each.
{
  const r = await get('https://data.sec.gov/api/xbrl/companyfacts/CIK0001045810.json', sec);
  const j = JSON.parse(r.text) as {
    cik: number;
    entityName: string;
    facts: Record<
      string,
      Record<string, { label?: string; units: Record<string, { end: string }[]> }>
    >;
  };
  const keep: Record<string, string[]> = {
    'us-gaap': [
      'Revenues',
      'RevenueFromContractWithCustomerExcludingAssessedTax',
      'GrossProfit',
      'OperatingIncomeLoss',
      'NetIncomeLoss',
      'EarningsPerShareDiluted',
      'WeightedAverageNumberOfDilutedSharesOutstanding',
      'Assets',
      'Liabilities',
      'StockholdersEquity',
      'CashAndCashEquivalentsAtCarryingValue',
      'LongTermDebt',
      'NetCashProvidedByUsedInOperatingActivities',
      'PaymentsToAcquirePropertyPlantAndEquipment',
    ],
    dei: ['EntityCommonStockSharesOutstanding'],
  };
  const out: Record<string, Record<string, unknown>> = {};
  for (const [taxonomy, names] of Object.entries(keep)) {
    out[taxonomy] = {};
    for (const n of names) {
      const c = j.facts[taxonomy]?.[n];
      if (!c) continue;
      const units: Record<string, unknown[]> = {};
      for (const [u, rows] of Object.entries(c.units)) units[u] = rows.slice(-16);
      out[taxonomy][n] = { label: c.label, units };
    }
  }
  emit(
    'sec-companyfacts-NVDA',
    {
      source: 'sec_edgar',
      endpoint: '/api/xbrl/companyfacts/CIK{cik}.json',
      status: r.status,
      trimmedTo: 'selected concepts, 16 newest entries per unit',
    },
    { cik: j.cik, entityName: j.entityName, facts: out },
  );
}
await sleep(300);

// SEC Form 4: the raw XML of the 3 newest Form 4s listed for NVIDIA.
{
  const s = JSON.parse(
    (await get('https://data.sec.gov/submissions/CIK0001045810.json', sec)).text,
  ) as {
    filings: { recent: { accessionNumber: string[]; form: string[]; primaryDocument: string[] } };
  };
  const r = s.filings.recent;
  let n = 0;
  for (let i = 0; i < r.form.length && n < 3; i += 1) {
    if (r.form[i] !== '4') continue;
    const acc = r.accessionNumber[i] as string;
    const doc = (r.primaryDocument[i] as string).replace(/^xsl[^/]*\//, '');
    const url = `https://www.sec.gov/Archives/edgar/data/1045810/${acc.replace(/-/g, '')}/${doc}`;
    const x = await get(url, sec);
    emit(
      `sec-form4-${acc}`,
      {
        source: 'sec_edgar',
        endpoint: url.replace(/^https:\/\/www\.sec\.gov/, ''),
        status: x.status,
      },
      x.text,
    );
    n += 1;
    await sleep(300);
  }
}

// Massive: news, short interest, short volume and dividends for NVDA.
for (const [name, path] of [
  ['massive-news-NVDA', '/v2/reference/news?ticker=NVDA&limit=30&order=desc&sort=published_utc'],
  [
    'massive-short-interest-NVDA',
    '/stocks/v1/short-interest?ticker=NVDA&settlement_date.gte=2025-06-01&sort=settlement_date.asc&limit=60',
  ],
  [
    'massive-short-volume-NVDA',
    '/stocks/v1/short-volume?ticker=NVDA&date.gte=2026-10-01&sort=date.asc&limit=60',
  ],
  [
    'massive-dividends-NVDA',
    '/stocks/v1/dividends?ticker=NVDA&ex_dividend_date.gte=2024-01-01&sort=ex_dividend_date.asc&limit=20',
  ],
] as const) {
  const r = await get(`https://api.massive.com${path}`, { Authorization: `Bearer ${massiveKey}` });
  let body: unknown = r.text.slice(0, 500);
  try {
    body = JSON.parse(r.text);
  } catch {
    /* keep the truncated text so a failure is visible */
  }
  emit(name, { source: 'massive', endpoint: path, status: r.status }, body);
  await sleep(13_000); // free plan: about 5 calls a minute
}

export {};
