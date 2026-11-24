import {
  fetchForm4,
  runJob,
  type HttpClient,
  type JobRunRecord,
  type SecConfig,
} from '@marsad/core';
import type { Store } from './store.js';

export interface InsidersJobDeps {
  http: HttpClient;
  cfg: SecConfig;
  store: Store;
  now: () => Date;
  /** Most filings read per run, newest first; the SEC allows 10 requests a second and the client stays well under. */
  limit?: number;
}

/**
 * Reads the XML of Form 4 filings already listed in `filings` and stores the insider, the 10b5-1 flag and every
 * transaction. A filing whose document cannot be read (an error page, a malformed document) is stored as an
 * error row so it is shown and not retried forever; a network or rate-limit failure is not stored, so the next
 * run retries it, and the run is an error either way. Nothing is ever recorded as "no transactions" by default.
 */
export async function runInsidersJob(deps: InsidersJobDeps): Promise<JobRunRecord> {
  const { store, now, http, cfg } = deps;
  const run = await runJob(
    'sec-insiders',
    async () => {
      const started = now().getTime();
      const candidates = await store.getUnreadInsiderFilings(deps.limit ?? 80);
      let rows = 0;
      let ok = 0;
      let unreadable = 0;
      const failed: string[] = [];
      for (const c of candidates) {
        let r;
        try {
          r = await fetchForm4(http, cfg, c.cik, c.accession, c.primaryDocument);
        } catch (e) {
          // The index entry is not an ownership XML document: a permanent fact about this filing.
          await store.saveInsiderFiling({
            status: 'error',
            accession: c.accession,
            issuerCik: c.cik,
            filedAt: c.acceptedAt,
            error: e instanceof Error ? e.message : String(e),
          });
          unreadable += 1;
          continue;
        }
        if (r.ok && r.data.value) {
          rows += await store.saveInsiderFiling({
            status: 'ok',
            accession: c.accession,
            issuerCik: c.cik,
            filedAt: c.acceptedAt,
            doc: r.data.value,
          });
          ok += 1;
        } else if (!r.ok && r.kind === 'invalid-response') {
          await store.saveInsiderFiling({
            status: 'error',
            accession: c.accession,
            issuerCik: c.cik,
            filedAt: c.acceptedAt,
            error: r.display,
          });
          unreadable += 1;
        } else if (!r.ok) {
          failed.push(`${c.accession}: ${r.display} (${r.kind})`);
        }
      }
      if (failed.length > 0 || unreadable > 0) {
        throw new Error(
          `Insider filings: ${ok} read, ${unreadable} unreadable (stored as errors), ${failed.length} failed to fetch${failed.length ? `: ${failed.slice(0, 3).join('; ')}` : ''}`.slice(
            0,
            480,
          ),
        );
      }
      await store.updateSourceStatus({
        source: 'sec_insiders',
        lastMessageAt: now(),
        latencyMs: now().getTime() - started,
        planTier: 'real-time',
        state: 'live',
        note: `${ok} filings read this run`,
      });
      return { rows, details: { read: ok, candidates: candidates.length } };
    },
    () => now().getTime(),
  );
  await store.recordRun(run);
  return run;
}
