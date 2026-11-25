import {
  BAR_ONLY_TICKERS,
  STARTING_TICKERS,
  buildCalendar,
  etDate,
  fetchDailyBars,
  lastCompletedTradingDay,
  runJob,
  type HttpClient,
  type JobRunRecord,
  type MassiveConfig,
} from '@marsad/core';
import type { Store } from './store.js';

export interface BarsJobDeps {
  http: HttpClient;
  cfg: MassiveConfig;
  store: Store;
  now: () => Date;
  tickers?: readonly string[];
}

/** The free Massive plan returns two years of daily bars (500 for NVDA on 2026-11-24). */
const WINDOW_DAYS = 730;

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Stores the daily bars of every tracked ticker for the whole two-year window, split-adjusted by the vendor
 * as of this run. Re-fetching the window each time keeps the stored history on one scale after a split.
 * A bar for a session that has not finished is left out, so a manual run mid-session never stores a
 * partial day. A ticker that fails (for example a plan problem) is named and the run is an error.
 */
export async function runBarsJob(deps: BarsJobDeps): Promise<JobRunRecord> {
  const { store, now, http, cfg } = deps;
  const tickers = deps.tickers ?? [...STARTING_TICKERS, ...BAR_ONLY_TICKERS];
  const run = await runJob(
    'massive-bars',
    async () => {
      const started = now().getTime();
      const calendar = buildCalendar(await store.getHolidays('NYSE'), 'NYSE');
      const lastDay = lastCompletedTradingDay(now(), calendar);
      if (lastDay === null)
        throw new Error('No completed trading day found, cannot tell which bars are final');
      const from = isoDate(new Date(now().getTime() - WINDOW_DAYS * 86_400_000));
      let rows = 0;
      let latest = '';
      const failed: string[] = [];
      for (const ticker of tickers) {
        const r = await fetchDailyBars(http, cfg, ticker, from, isoDate(now()));
        if (!r.ok) {
          failed.push(`${ticker}: ${r.display} (${r.kind})`);
          continue;
        }
        const final = (r.data.value ?? []).filter((b) => etDate(new Date(b.t)) <= lastDay);
        if (final.length === 0) {
          failed.push(`${ticker}: no bars returned`);
          continue;
        }
        rows += await store.upsertDailyBars(ticker, final, now());
        const last = etDate(new Date(final[final.length - 1]?.t ?? 0));
        if (last > latest) latest = last;
      }
      if (failed.length > 0)
        throw new Error(`Daily bars failed: ${failed.join('; ')}`.slice(0, 480));
      await store.updateSourceStatus({
        source: 'massive_bars',
        lastMessageAt: now(),
        latencyMs: now().getTime() - started,
        planTier: 'end-of-day',
        state: 'live',
        note: `${tickers.length} tickers, latest bar ${latest}`,
      });
      return {
        rows,
        details: { tickers: tickers.length, latest, window: `${from} to ${isoDate(now())}` },
      };
    },
    () => now().getTime(),
  );
  await store.recordRun(run);
  return run;
}
