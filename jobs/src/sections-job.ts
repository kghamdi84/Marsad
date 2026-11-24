import {
  STARTING_STOCKS,
  fetchAnnualSections,
  runJob,
  type HttpClient,
  type JobRunRecord,
  type MassiveConfig,
} from '@marsad/core';
import type { Store } from './store.js';

export interface SectionsJobDeps {
  http: HttpClient;
  cfg: MassiveConfig;
  store: Store;
  now: () => Date;
  tickers?: readonly string[];
}

/**
 * Stores the two newest 10-K risk-factor sections of each tracked company, for the year-over-year comparison.
 * ETFs have no 10-K, so only the stocks are asked. A company the vendor has no annual report for is listed in the
 * run details (a coverage gap, not an error); a failed request is named and makes the run an error. The source is
 * marked live only when every request worked.
 */
export async function runSectionsJob(deps: SectionsJobDeps): Promise<JobRunRecord> {
  const { store, now, http, cfg } = deps;
  const tickers = deps.tickers ?? STARTING_STOCKS;
  const run = await runJob(
    'massive-sections',
    async () => {
      const started = now().getTime();
      const failed: string[] = [];
      const periodEnds: Record<string, string[]> = {};
      const noAnnualReport: string[] = [];
      let rows = 0;
      for (const t of tickers) {
        const r = await fetchAnnualSections(http, cfg, t, 'risk_factors', 2);
        if (!r.ok) {
          failed.push(`${t}: ${r.display} (${r.kind})`);
          continue;
        }
        const sections = r.data.value ?? [];
        if (sections.length === 0) {
          noAnnualReport.push(t);
          continue;
        }
        rows += await store.upsertAnnualSections(sections, now());
        periodEnds[t] = sections.map((s) => s.periodEnd);
      }
      if (failed.length > 0) throw new Error(`Sections failed: ${failed.join('; ')}`.slice(0, 480));
      await store.updateSourceStatus({
        source: 'massive_sections',
        lastMessageAt: now(),
        latencyMs: now().getTime() - started,
        planTier: 'end-of-day',
        state: 'live',
        note:
          `${Object.keys(periodEnds).length} of ${tickers.length} companies` +
          (noAnnualReport.length > 0
            ? `; no 10-K from the vendor for ${noAnnualReport.join(', ')}`
            : ''),
      });
      return { rows, details: { periodEnds, noAnnualReport } };
    },
    () => now().getTime(),
  );
  await store.recordRun(run);
  return run;
}
