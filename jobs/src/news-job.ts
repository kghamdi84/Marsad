import {
  STARTING_TICKERS,
  fetchNews,
  runJob,
  type HttpClient,
  type JobRunRecord,
  type MassiveConfig,
  type NewsArticle,
} from '@marsad/core';
import type { Store } from './store.js';

export interface NewsJobDeps {
  http: HttpClient;
  cfg: MassiveConfig;
  store: Store;
  now: () => Date;
  tickers?: readonly string[];
}

/** The 30 newest articles for each tracked ticker, merged by article id (one article can tag several tickers). */
export async function runNewsJob(deps: NewsJobDeps): Promise<JobRunRecord> {
  const { store, now, http, cfg } = deps;
  const tickers = deps.tickers ?? STARTING_TICKERS;
  const run = await runJob(
    'massive-news',
    async () => {
      const started = now().getTime();
      const byId = new Map<string, NewsArticle>();
      const failed: string[] = [];
      for (const t of tickers) {
        const r = await fetchNews(http, cfg, t, 30);
        if (!r.ok) {
          failed.push(`${t}: ${r.display} (${r.kind})`);
          continue;
        }
        for (const a of r.data.value ?? []) byId.set(a.id, a);
      }
      const rows = await store.upsertNewsArticles([...byId.values()], now());
      if (failed.length > 0) throw new Error(`News failed: ${failed.join('; ')}`.slice(0, 480));
      const newest = [...byId.values()].reduce(
        (m, a) => (a.publishedAt > m ? a.publishedAt : m),
        '',
      );
      await store.updateSourceStatus({
        source: 'massive_news',
        lastMessageAt: now(),
        latencyMs: now().getTime() - started,
        planTier: 'end-of-day',
        state: 'live',
        note: `${byId.size} articles, newest ${newest.slice(0, 16)}Z`,
      });
      return { rows, details: { tickers: tickers.length, articles: byId.size, newest } };
    },
    () => now().getTime(),
  );
  await store.recordRun(run);
  return run;
}
