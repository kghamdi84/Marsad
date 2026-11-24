import {
  FRED_SERIES,
  fetchFredSeries,
  runJob,
  type FredConfig,
  type FredObservation,
  type FredSeriesId,
  type HttpClient,
  type JobRunRecord,
} from '@marsad/core';
import type { Store } from './store.js';

export interface FredJobDeps {
  http: HttpClient;
  apiKey: string;
  store: Store;
  now: () => Date;
  /** Earliest observation to request. Defaults to 1990-01-01, enough history for the event studies. */
  observationStart?: string;
  /** Called with the newest few observations of each series, for the run log (public numbers only). */
  logSample?: (series: string, newest: FredObservation[]) => void;
}

/**
 * Fetches every FRED series Marsad uses and stores it. Series that fail are reported by name and make
 * the run an error, but the series that succeeded are still stored. The source status is marked live
 * only when every series succeeded, so a partial failure shows as silence rather than as fresh data.
 */
export async function runFredJob(deps: FredJobDeps): Promise<JobRunRecord> {
  const { store, now, http } = deps;
  const cfg: FredConfig = { apiKey: deps.apiKey, now };
  const run = await runJob(
    'fred-daily',
    async () => {
      const started = now().getTime();
      const ids = Object.keys(FRED_SERIES) as FredSeriesId[];
      const failed: string[] = [];
      const counts: Record<string, number> = {};
      let total = 0;
      for (const id of ids) {
        const r = await fetchFredSeries(http, cfg, id, deps.observationStart ?? '1990-01-01');
        if (!r.ok) {
          failed.push(`${id}: ${r.kind}`);
          continue;
        }
        const obs = r.data.value ?? [];
        if (obs.length === 0) {
          failed.push(`${id}: empty`);
          continue;
        }
        total += await store.upsertFredObservations(id, obs, now());
        counts[id] = obs.length;
        deps.logSample?.(id, obs.slice(-3));
      }
      if (failed.length > 0) throw new Error(`FRED series failed: ${failed.join(', ')}`);
      await store.updateSourceStatus({
        source: 'fred',
        lastMessageAt: now(),
        latencyMs: now().getTime() - started,
        planTier: 'end-of-day',
        state: 'live',
        note: `${ids.length} series updated`,
      });
      return { rows: total, details: { series: counts } };
    },
    () => now().getTime(),
  );
  await store.recordRun(run);
  return run;
}
