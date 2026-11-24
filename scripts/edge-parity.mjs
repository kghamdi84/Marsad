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
};
console.log(JSON.stringify(out));
