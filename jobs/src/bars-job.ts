import {
  BAR_ONLY_TICKERS,
  SECTOR_ETFS,
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

/** At most this many saved-watchlist tickers a night: about 12 seconds each at the free plan's 5 calls a minute. */
export const MAX_WATCHLIST_EXTRAS = 40;

/**
 * Saved-watchlist tickers to add to the nightly run: valid symbols only, in a stable order, capped so a long
 * watchlist cannot make the run outlast its workflow timeout. The starting list is already fetched separately.
 */
export function watchlistExtras(saved: readonly string[]): string[] {
  const valid = saved
    .map((t) => t.trim().toUpperCase())
    .filter(
      (t) =>
        /^[A-Z][A-Z0-9.]{0,9}$/.test(t) && !(STARTING_TICKERS as readonly string[]).includes(t),
    );
  return [...new Set(valid)].sort().slice(0, MAX_WATCHLIST_EXTRAS);
}

/**
 * Stores the daily bars of every tracked ticker, sector ETF and open holding for the whole two-year window, split-adjusted by the vendor
 * as of this run. Re-fetching the window each time keeps the stored history on one scale after a split.
 * A bar for a session that has not finished is left out, so a manual run mid-session never stores a
 * partial day. A ticker that fails (for example a plan problem) is named and the run is an error.
 */
export async function runBarsJob(deps: BarsJobDeps): Promise<JobRunRecord> {
  const { store, now, http, cfg } = deps;
  const run = await runJob(
    'massive-bars',
    async () => {
      // The tracked list, the sector ETFs (sector betas, shocks and rotation), every open holding (exit rules)
      // and the tickers on saved watchlists (council batch 1), so a ticker someone adds gets prices the next night.
      const tickers = deps.tickers ?? [
        ...new Set([
          ...STARTING_TICKERS,
          ...BAR_ONLY_TICKERS,
          ...SECTOR_ETFS.map((s) => s.ticker),
          ...(await store.getOpenHoldings()).map((h) => h.ticker),
          ...watchlistExtras(await store.getWatchlistTickers()),
        ]),
      ];
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
