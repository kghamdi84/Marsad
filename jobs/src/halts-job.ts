import {
  fetchHalts,
  runJob,
  type HttpClient,
  type JobRunRecord,
  type NasdaqConfig,
} from '@marsad/core';
import type { Store } from './store.js';

export interface HaltsJobDeps {
  http: HttpClient;
  cfg: NasdaqConfig;
  store: Store;
  now: () => Date;
}

/**
 * Fetches the Nasdaq trade-halts feed and stores every halt. A page that is not the feed, or items that
 * cannot be read, are errors, never "no halts". The source is marked live only after a good fetch.
 */
export async function runHaltsJob(deps: HaltsJobDeps): Promise<JobRunRecord> {
  const { store, now, http, cfg } = deps;
  const run = await runJob(
    'nasdaq-halts',
    async () => {
      const started = now().getTime();
      const r = await fetchHalts(http, cfg);
      if (!r.ok) throw new Error(`Halts feed unavailable: ${r.display} (${r.kind})`);
      const feed = r.data.value;
      if (feed === null) throw new Error('Halts feed returned no data');
      if (feed.skipped.length > 0) {
        throw new Error(
          `Halts feed had ${feed.skipped.length} unreadable items: ${feed.skipped[0]?.reason ?? ''}`,
        );
      }
      const rows = await store.upsertHalts(feed.items, now());
      const active = feed.items.filter((h) => h.active).length;
      const newsRelated = feed.items.filter((h) => h.newsRelated && h.active).length;
      await store.updateSourceStatus({
        source: 'nasdaq_halts',
        lastMessageAt: now(),
        latencyMs: now().getTime() - started,
        planTier: 'real-time',
        state: 'live',
        note: `${feed.items.length} halts today, ${active} active`,
      });
      return {
        rows,
        details: { halts: feed.items.length, active, newsRelatedActive: newsRelated },
      };
    },
    () => now().getTime(),
  );
  await store.recordRun(run);
  return run;
}
