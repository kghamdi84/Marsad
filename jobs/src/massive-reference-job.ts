import {
  fetchMarketHolidays,
  fetchSplits,
  runJob,
  STARTING_TICKERS,
  type HttpClient,
  type JobRunRecord,
  type MassiveConfig,
  type Split,
} from '@marsad/core';
import type { Store } from './store.js';

export interface MassiveReferenceDeps {
  http: HttpClient;
  cfg: MassiveConfig;
  store: Store;
  now: () => Date;
  tickers?: readonly string[];
}

/**
 * Stores the market holiday calendar and the split history of the tracked tickers. Failures are named
 * (with the reason, so a missing plan shows as "requires plan"), the run is an error, and the source is
 * marked live only when everything succeeded.
 */
export async function runMassiveReferenceJob(deps: MassiveReferenceDeps): Promise<JobRunRecord> {
  const { store, now, http, cfg } = deps;
  const run = await runJob(
    'massive-reference',
    async () => {
      const started = now().getTime();
      const failed: string[] = [];
      let rows = 0;

      const cal = await fetchMarketHolidays(http, cfg);
      if (cal.ok) rows += await store.upsertMarketHolidays(cal.data.value ?? [], now());
      else failed.push(`calendar: ${cal.display} (${cal.kind})`);

      const splits: Split[] = [];
      for (const ticker of deps.tickers ?? STARTING_TICKERS) {
        const r = await fetchSplits(http, cfg, ticker);
        if (r.ok) splits.push(...(r.data.value ?? []));
        else failed.push(`splits ${ticker}: ${r.display} (${r.kind})`);
      }
      rows += await store.upsertSplits(splits, now());

      if (failed.length > 0)
        throw new Error(`Massive reference failed: ${failed.join('; ')}`.slice(0, 480));
      await store.updateSourceStatus({
        source: 'massive_reference',
        lastMessageAt: now(),
        latencyMs: now().getTime() - started,
        planTier: 'end-of-day',
        state: 'live',
        note: `Calendar and splits for ${(deps.tickers ?? STARTING_TICKERS).length} tickers`,
      });
      return {
        rows,
        details: { holidays: cal.ok ? (cal.data.value?.length ?? 0) : 0, splits: splits.length },
      };
    },
    () => now().getTime(),
  );
  await store.recordRun(run);
  return run;
}
