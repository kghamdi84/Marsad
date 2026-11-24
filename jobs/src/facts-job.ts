import {
  STUDY_CONCEPTS,
  fetchCompanyFacts,
  runJob,
  type HttpClient,
  type JobRunRecord,
  type SecConfig,
} from '@marsad/core';
import type { Store } from './store.js';

export interface FactsJobDeps {
  http: HttpClient;
  cfg: SecConfig;
  store: Store;
  now: () => Date;
}

/**
 * Stores the financial-statement facts the Study page reads, for every company the SEC filings job has found.
 * Each fact keeps the filing that reported it, so the page can show what was known on any date. A company
 * that fails, or returns none of the expected concepts, is named and makes the run an error.
 */
export async function runFactsJob(deps: FactsJobDeps): Promise<JobRunRecord> {
  const { store, now, http, cfg } = deps;
  const run = await runJob(
    'sec-facts',
    async () => {
      const started = now().getTime();
      const companies = await store.getInstruments();
      if (companies.length === 0)
        throw new Error('No instruments stored yet: the SEC filings job has to run first');
      const failed: string[] = [];
      let rows = 0;
      const perCompany: Record<string, number> = {};
      for (const c of companies) {
        const r = await fetchCompanyFacts(http, cfg, c.cik);
        if (!r.ok) {
          failed.push(`${c.ticker}: ${r.display} (${r.kind})`);
          continue;
        }
        const keep = (r.data.value?.facts ?? []).filter((f) =>
          STUDY_CONCEPTS[f.taxonomy]?.includes(f.concept),
        );
        if (keep.length === 0) {
          failed.push(`${c.ticker}: none of the expected concepts were reported`);
          continue;
        }
        rows += await store.upsertFinancialFacts(c.cik, keep, now());
        perCompany[c.ticker] = keep.length;
      }
      if (failed.length > 0)
        throw new Error(`Financial facts failed: ${failed.join('; ')}`.slice(0, 480));
      await store.updateSourceStatus({
        source: 'sec_facts',
        lastMessageAt: now(),
        latencyMs: now().getTime() - started,
        planTier: 'real-time',
        state: 'live',
        note: `${companies.length} companies, ${rows} facts`,
      });
      return { rows, details: { companies: companies.length, perCompany } };
    },
    () => now().getTime(),
  );
  await store.recordRun(run);
  return run;
}
