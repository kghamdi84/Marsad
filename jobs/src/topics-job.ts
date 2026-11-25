import {
  TOPICS_VERSION,
  fetchNewsDay,
  runJob,
  topicDay,
  type HttpClient,
  type JobRunRecord,
  type MassiveConfig,
  type TopicDay,
} from '@marsad/core';
import type { Store } from './store.js';

export interface TopicsJobDeps {
  http: HttpClient;
  cfg: MassiveConfig;
  store: Store;
  now: () => Date;
  /** Days of history kept (7 recent plus 28 baseline). */
  windowDays?: number;
  /** Most days fetched in one run. */
  maxDays?: number;
}

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * Counts geopolitical topics in market-wide news per complete UTC day (ADR 0012): fetches each missing day of the
 * window, plus the last 2 days again for late-indexed articles, and stores counts and sample headlines. Resumable.
 */
export async function runTopicsJob(deps: TopicsJobDeps): Promise<JobRunRecord> {
  const { http, cfg, store, now } = deps;
  const run = await runJob(
    'massive-topics',
    async () => {
      const started = now().getTime();
      const today = Date.parse(`${now().toISOString().slice(0, 10)}T00:00:00Z`);
      const window = deps.windowDays ?? 35;
      const days: string[] = [];
      for (let t = today - window * DAY; t < today; t += DAY) days.push(iso(t));
      const stored = new Set(await store.getTopicDates());
      const refresh = new Set(days.slice(-2));
      const todo = days
        .filter((d) => !stored.has(d) || refresh.has(d))
        .slice(-(deps.maxDays ?? 40));
      const rows: TopicDay[] = [];
      const failed: string[] = [];
      for (const d of todo) {
        const r = await fetchNewsDay(http, cfg, d);
        if (!r.ok) {
          failed.push(`${d}: ${r.display} (${r.kind}: ${r.message})`);
          continue;
        }
        const seen = new Set<string>();
        const unique = (r.data.value ?? []).filter((a) => !seen.has(a.id) && seen.add(a.id));
        rows.push(topicDay(d, unique));
      }
      const written = await store.upsertTopicDays(rows, now());
      if (failed.length > 0)
        throw new Error(
          `Topics: ${rows.length} days stored, then: ${failed.join('; ')}`.slice(0, 480),
        );
      const last = rows.at(-1);
      await store.updateSourceStatus({
        source: 'massive_topics',
        lastMessageAt: now(),
        latencyMs: now().getTime() - started,
        planTier: 'end-of-day',
        state: 'live',
        note: last
          ? `${TOPICS_VERSION}: ${last.date}, ${last.total} articles`
          : 'Nothing new to fetch',
      });
      return {
        rows: written,
        details: {
          fetched: rows.length,
          latest: last?.date ?? null,
          articles: last?.total ?? null,
        },
      };
    },
    () => now().getTime(),
  );
  await store.recordRun(run);
  return run;
}
