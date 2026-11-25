import { STARTING_TICKERS, haltAlerts, runJob, type JobRunRecord } from '@marsad/core';
import { alertContext, pipelineAndStore } from './alert-writer.js';
import type { Store } from './store.js';

export interface HaltAlertsJobDeps {
  store: Store;
  now: () => Date;
}

/**
 * Turns halts and resumptions in watched tickers (the starting list and any saved watchlist) into alerts through the
 * pipeline (ADR 0019), and stores each with its input snapshot, decision and reasons. An event already stored is
 * never stored again by a later run.
 */
export async function runHaltAlertsJob(deps: HaltAlertsJobDeps): Promise<JobRunRecord> {
  const { store, now } = deps;
  const run = await runJob(
    'alerts-halts',
    async () => {
      const at = now();
      const watched = new Set([...STARTING_TICKERS, ...(await store.getWatchlistTickers())]);
      const halts = (
        await store.getRecentHalts(new Date(at.getTime() - 12 * 3_600_000).toISOString())
      ).filter((h) => watched.has(h.symbol));
      const context = await alertContext(store);
      const items = halts.flatMap((h) =>
        haltAlerts(h, context, at).map((input) => ({
          input,
          sourceAt: input.eventId?.startsWith('resume:') ? h.resumptionTradeAt : h.lastSeenAt,
        })),
      );
      const { rows, decisions } = await pipelineAndStore(store, items, at);
      return { rows, details: { watched: watched.size, halts: halts.length, decisions } };
    },
    () => now().getTime(),
  );
  await store.recordRun(run);
  return run;
}
