/**
 * Runs the same core calculations under Node (from packages/core/src) and under Deno (from the generated
 * Edge Function copy) and prints JSON, so CI can require byte-identical output. One engine, two runtimes
 * (integrity rule 3). Usage:
 *   node --import tsx scripts/edge-parity.mjs packages/core/src/index.ts
 *   deno run -A --no-lock scripts/edge-parity.mjs supabase/functions/_shared/core/index.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const arg = (globalThis.Deno ? globalThis.Deno.args : process.argv.slice(2))[0];
if (!arg) throw new Error('Pass the path to the core index.ts');
const core = await import(pathToFileURL(resolve(arg)).href);

const upcoming = JSON.parse(
  readFileSync(join(root, 'fixtures/massive/market-status-upcoming.json'), 'utf8'),
);
const golden = JSON.parse(readFileSync(join(root, 'fixtures/indicators/golden.json'), 'utf8'));
const cal = core.buildCalendar(upcoming.data, 'NYSE');
const instants = [
  '2026-11-24T14:00:00Z', // pre-market
  '2026-11-24T20:46:00Z', // regular
  '2026-11-27T19:30:00Z', // day after Thanksgiving, early close
  '2026-11-26T15:00:00Z', // Thanksgiving, closed
];
const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 5 + i * 0.1);
const highs = closes.map((c) => c + 1);
const lows = closes.map((c) => c - 1);
const volume = closes.map((_, i) => 1000 + i * 10);
const aiPayload = {
  facts: [
    { id: 'F1', label: 'Revenue', value: 4_180_000_000, unit: 'usd' },
    { id: 'F2', label: 'Revenue growth', value: 12.4, unit: 'pct' },
    { id: 'F3', label: 'Operating margin change', value: -2.5, unit: 'pct' },
    { id: 'F4', label: '8-K item 5.02 filed in FY2026', value: '5.02', unit: 'text' },
  ],
  documents: [],
};
const policy = core.DEFAULT_SOURCE_POLICIES.find((p) => p.source === 'nasdaq_halts');
const out = {
  sma: core.sma(closes, 20),
  ema: core.ema(closes, 12),
  rsi: core.rsi(closes, 14),
  atr: core.atr(highs, lows, closes, 14),
  vwap: core.vwap(highs, lows, closes, volume),
  rvol: core.rvol(volume, 20),
  macd: core.macd(closes),
  sessions: instants.map((i) => core.sessionInfo(new Date(i), cal)),
  health: core.evaluateSourceHealth(
    policy,
    new Date('2026-11-24T20:10:00Z'),
    new Date('2026-11-24T20:46:00Z'),
    cal,
  ),
  etWall: core.etWallToUtc('2026-11-24', 9, 30).toISOString(),
  goldenKeys: Object.keys(golden).sort(),
  // The verifier and the filings and news knowledge must behave identically in both runtimes.
  verify: [
    'Revenue was $4.18B [F1]. Revenue grew 12.4% year over year [F2].',
    'Revenue grew 14.1% year over year [F2].',
    'Operating margin rose 2.5% [F3].',
    'Revenue was $4.2B [F2].',
    'The FY2026 10-K lists item 5.02 [F4].',
  ].map((t) => core.verifyText(t, aiPayload)),
  eightK: core.describeEightK(['9.01', '2.02', '5.02']),
  news: core.clusterNews([
    {
      id: 'a',
      publisher: 'Reuters',
      title: 'Nvidia CEO Jensen Huang reinstated after board vote',
      publishedAt: '2026-11-24T14:00:00Z',
      url: 'u',
      tickers: ['NVDA'],
    },
    {
      id: 'b',
      publisher: 'Bloomberg',
      title: 'Nvidia reinstates CEO Jensen Huang after board vote',
      publishedAt: '2026-11-24T14:20:00Z',
      url: 'u',
      tickers: ['NVDA'],
    },
  ]),
  form4: (() => {
    const f4 = JSON.parse(
      readFileSync(join(root, 'fixtures/sec/form4-0001696841-26-000016.json'), 'utf8'),
    );
    const doc = core.parseForm4(f4.body);
    return { doc, summary: core.summarizeForm4(doc) };
  })(),
  financials: (() => {
    const cf = JSON.parse(
      readFileSync(join(root, 'fixtures/sec/companyfacts-NVDA-trimmed.json'), 'utf8'),
    );
    const parsed = core.parseCompanyFacts(cf.body);
    return core.summarizeFinancials(parsed.facts, '2026-12-31');
  })(),
  rounding: [81.615, 1.005, 2.675, -2.675, 0.5, 188.4, 1e21].map((n) => core.toFixedHalfUp(n, 2)),
  cost: core.costOfUsage('claude-sonnet-5-5', {
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 40000,
    cacheWriteTokens: 8000,
  }),
};
console.log(JSON.stringify(out));
