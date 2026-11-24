import {
  fetchCompanyTickers,
  fetchRecentFilings,
  runJob,
  STARTING_STOCKS,
  type HttpClient,
  type JobRunRecord,
  type SecConfig,
} from '@marsad/core';
import type { Store } from './store.js';

export interface SecJobDeps {
  http: HttpClient;
  cfg: SecConfig;
  store: Store;
  now: () => Date;
  tickers?: readonly string[];
}

/**
 * Looks up each watchlist company's CIK, stores the instruments, then stores each company's recent
 * filings. Failures are named per ticker and make the run an error; the source is marked live only when
 * everything succeeded. Requests go through the caller's rate-limited client (well under 10 a second).
 */
export async function runSecJob(deps: SecJobDeps): Promise<JobRunRecord> {
  const { store, now, http, cfg } = deps;
  const run = await runJob(
    'sec-filings',
    async () => {
      const started = now().getTime();
      const tickers = deps.tickers ?? STARTING_STOCKS;
      const map = await fetchCompanyTickers(http, cfg);
      if (!map.ok) throw new Error(`SEC ticker file unavailable: ${map.display} (${map.kind})`);
      const byTicker = new Map((map.data.value ?? []).map((c) => [c.ticker, c]));
      const failed: string[] = [];
      const found = tickers.flatMap((t) => {
        const c = byTicker.get(t);
        if (!c) {
          failed.push(`${t}: no CIK in the SEC ticker file`);
          return [];
        }
        return [c];
      });
      let rows = await store.upsertInstruments(found);
      const counts: Record<string, number> = {};
      for (const c of found) {
        const r = await fetchRecentFilings(http, cfg, c.cik);
        if (!r.ok) {
          failed.push(`${c.ticker}: ${r.display} (${r.kind})`);
          continue;
        }
        const filings = r.data.value ?? [];
        rows += await store.upsertFilings(c.cik, filings, now());
        counts[c.ticker] = filings.length;
      }
      if (failed.length > 0) throw new Error(`SEC job failed: ${failed.join('; ')}`.slice(0, 480));
      await store.updateSourceStatus({
        source: 'sec_edgar',
        lastMessageAt: now(),
        latencyMs: now().getTime() - started,
        planTier: 'real-time',
        state: 'live',
        note: `Recent filings for ${found.length} companies`,
      });
      return { rows, details: { filings: counts } };
    },
    () => now().getTime(),
  );
  await store.recordRun(run);
  return run;
}
