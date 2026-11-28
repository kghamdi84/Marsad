/**
 * One-off spot check for checklist 3.3 (read only, writes nothing). Computes the breadth-1 share above the 200- and
 * 50-day averages over SPY's newest stored N-PORT holdings (the S&P 500), from the same stored daily snapshots and
 * split adjustment as Marsad universe breadth, so it can be compared with published S&P 500 breadth. Reads
 * SUPABASE_URL and SUPABASE_SECRET_KEY; never logs them. CHECK_DATES lists the dates (comma separated).
 */
import { createClient } from '@supabase/supabase-js';
import { adjustForSplits, type TickerSeries } from '@marsad/core';
import { memberBreadth } from './breadth-check.js';
import { supabaseStore } from './store.js';

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

const url = need('SUPABASE_URL');
const key = need('SUPABASE_SECRET_KEY');
const on = (process.env['CHECK_DATES'] ?? '2026-11-24,2026-11-25,2026-11-27')
  .split(',')
  .map((d) => d.trim())
  .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
if (on.length === 0) throw new Error('CHECK_DATES has no date in YYYY-MM-DD form');

const db = createClient(url, key, { auth: { persistSession: false } });
const report = await db
  .from('etf_reports')
  .select('report_date, holdings, matched')
  .eq('etf', 'SPY')
  .order('report_date', { ascending: false })
  .limit(1);
if (report.error) throw new Error(`etf_reports read failed: ${report.error.message}`);
const latest = report.data?.[0];
if (!latest) throw new Error('No SPY N-PORT report stored');
const holdings = await db
  .from('etf_holdings')
  .select('ticker, asset_cat')
  .eq('etf', 'SPY')
  .eq('report_date', latest.report_date)
  .limit(1000);
if (holdings.error) throw new Error(`etf_holdings read failed: ${holdings.error.message}`);
const rows = holdings.data ?? [];
const members = [
  ...new Set(rows.filter((r) => r.asset_cat === 'EC' && r.ticker).map((r) => String(r.ticker))),
];

// About 220 sessions before the first check date, as the breadth job does.
const first = on.slice().sort()[0] as string;
const start = new Date(Date.parse(`${first}T00:00:00Z`) - 330 * 86_400_000)
  .toISOString()
  .slice(0, 10);
const store = supabaseStore(url, key);
const snaps = await store.loadSnapshots(start);
const dates = snaps.map((s) => s.date);
const raw = new Map<string, { close: (number | null)[]; volume: (number | null)[] }>();
snaps.forEach((s, i) => {
  for (const r of s.rows) {
    let t = raw.get(r.ticker);
    if (!t) {
      t = { close: new Array(dates.length).fill(null), volume: new Array(dates.length).fill(null) };
      raw.set(r.ticker, t);
    }
    t.close[i] = r.close;
    t.volume[i] = r.volume;
  }
});
const series = adjustForSplits(
  dates,
  raw as Map<string, TickerSeries>,
  await store.getShareChanges(start),
);
// The SEC ticker list writes share classes with a dash (BRK-B); Massive with a dot (BRK.B).
const resolved = members.map((m) => (series.has(m) ? m : m.replace('-', '.')));
const out = memberBreadth(dates, series, resolved, on);

const pct = (a: number, n: number) => (n > 0 ? `${((100 * a) / n).toFixed(2)}%` : 'n/a');
console.log(
  `breadth-check: SPY N-PORT ${String(latest.report_date)}, ${rows.length} holdings, ${members.length} common-stock tickers, ` +
    `${dates.length} stored sessions from ${dates[0] ?? 'none'} to ${dates.at(-1) ?? 'none'}`,
);
for (const b of out)
  console.log(
    `breadth-check ${b.date}: above 200-day ${b.above200}/${b.n200} = ${pct(b.above200, b.n200)}; ` +
      `above 50-day ${b.above50}/${b.n50} = ${pct(b.above50, b.n50)}; members with a stored close ${b.members}`,
  );
const missing = on.filter((d) => !out.some((b) => b.date === d));
if (missing.length) console.log(`breadth-check: not stored: ${missing.join(', ')}`);
