/**
 * Fixture recorder for SEC XBRL frames and the SEC ticker list (manual, workflow `record-fixtures` with script
 * `record-frames-main.ts`). Each frame lists one reported figure for every filer; the fixture keeps the rows of a
 * dozen well-known companies plus the total row count, so tests run on real values without megabytes of data.
 * Public SEC data only; prints bodies, never headers.
 */
const ua = process.env['SEC_USER_AGENT']?.trim();
if (!ua) throw new Error('Missing environment variable SEC_USER_AGENT');

// NVDA, AAPL, MSFT, KO, JNJ, XOM, INTC, F, PFE, WMT, BAC (a bank: no gross profit), T.
const KEEP = new Set([
  1045810, 320193, 789019, 21344, 200406, 34088, 50863, 37996, 78003, 104169, 70858, 732717,
]);
const FRAMES = [
  ['us-gaap', 'GrossProfit', 'USD', 'CY2025'],
  ['us-gaap', 'NetIncomeLoss', 'USD', 'CY2025'],
  ['us-gaap', 'NetCashProvidedByUsedInOperatingActivities', 'USD', 'CY2025'],
  ['us-gaap', 'Assets', 'USD', 'CY2025Q4I'],
  ['us-gaap', 'Liabilities', 'USD', 'CY2025Q4I'],
  ['us-gaap', 'StockholdersEquity', 'USD', 'CY2025Q4I'],
  ['dei', 'EntityCommonStockSharesOutstanding', 'shares', 'CY2025Q4I'],
  ['us-gaap', 'CommonStockSharesOutstanding', 'shares', 'CY2025Q4I'],
  // Fallbacks for companies that do not tag the figures above (ADR 0035).
  ['us-gaap', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'USD', 'CY2025'],
  ['us-gaap', 'Revenues', 'USD', 'CY2025'],
  ['us-gaap', 'CostOfRevenue', 'USD', 'CY2025'],
  ['us-gaap', 'CostOfGoodsAndServicesSold', 'USD', 'CY2025'],
  ['us-gaap', 'ProfitLoss', 'USD', 'CY2025'],
  [
    'us-gaap',
    'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
    'USD',
    'CY2025Q4I',
  ],
  ['us-gaap', 'WeightedAverageNumberOfDilutedSharesOutstanding', 'shares', 'CY2025'],
] as const;

const get = async (url: string) => {
  const res = await fetch(url, { headers: { 'User-Agent': ua, Accept: 'application/json' } });
  const text = await res.text();
  return { status: res.status, text };
};

for (const [tax, concept, unit, period] of FRAMES) {
  const path = `/api/xbrl/frames/${tax}/${concept}/${unit}/${period}.json`;
  const r = await get(`https://data.sec.gov${path}`);
  const name = `sec-frame-${concept}-${period}`;
  let body: unknown = r.text.slice(0, 300);
  if (r.status === 200) {
    const j = JSON.parse(r.text) as { data: { cik: number }[]; [k: string]: unknown };
    body = { ...j, totalRows: j.data.length, data: j.data.filter((d) => KEEP.has(d.cik)) };
  }
  console.log(`${name}: status ${r.status}, ${r.text.length} chars`);
  console.log(`FIXTURE_BEGIN ${name}`);
  console.log(
    JSON.stringify({
      recordedAt: new Date().toISOString(),
      endpoint: path,
      status: r.status,
      body,
    }),
  );
  console.log(`FIXTURE_END ${name}`);
  await new Promise((res) => setTimeout(res, 300));
}

const t = await get('https://www.sec.gov/files/company_tickers.json');
const all = JSON.parse(t.text) as Record<
  string,
  { cik_str: number; ticker: string; title: string }
>;
const kept = Object.fromEntries(Object.entries(all).filter(([, v]) => KEEP.has(v.cik_str)));
console.log(`company_tickers: status ${t.status}, ${Object.keys(all).length} rows`);
console.log('FIXTURE_BEGIN sec-company-tickers');
console.log(
  JSON.stringify({
    recordedAt: new Date().toISOString(),
    endpoint: '/files/company_tickers.json',
    status: t.status,
    totalRows: Object.keys(all).length,
    body: kept,
  }),
);
console.log('FIXTURE_END sec-company-tickers');

export {};
