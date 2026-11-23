import { parseGprRows, runJob, type JobRunRecord } from '@marsad/core';
import type { Store } from './store.js';

export const GPR_URL = 'https://www.matteoiacoviello.com/gpr_files/data_gpr_daily_recent.xls';

export interface GprJobDeps {
  /** Downloads the .xls and returns its bytes. */
  download(url: string): Promise<Uint8Array>;
  /** Converts the .xls bytes to row objects (the Python converter in production). */
  convert(xls: Uint8Array): Promise<Record<string, unknown>[]>;
  store: Store;
  now: () => Date;
}

/**
 * Downloads the daily GPR file, validates it, stores it, and records the run. Always writes a job run
 * record, including on failure, and updates the source status only on success so a failing job shows
 * as silence rather than as fresh data.
 */
export async function runGprJob(deps: GprJobDeps): Promise<JobRunRecord> {
  const { store, now } = deps;
  const run = await runJob(
    'gpr-daily',
    async () => {
      const started = now().getTime();
      const bytes = await deps.download(GPR_URL);
      if (bytes.length < 1000) throw new Error(`download too small (${bytes.length} bytes)`);
      const rows = await deps.convert(bytes);
      const { days, skipped } = parseGprRows(rows);
      if (days.length === 0) throw new Error('no valid GPR rows in the file');
      // A truncated or shifted file must not overwrite good data.
      if (days.length < 1000) throw new Error(`only ${days.length} valid rows, expected thousands`);
      const latest = days.reduce((m, d) => (d.date > m ? d.date : m), days[0]?.date ?? '');
      const written = await store.upsertGprDays(days, now());
      const latencyMs = now().getTime() - started;
      await store.updateSourceStatus({
        source: 'gpr',
        lastMessageAt: now(),
        latencyMs,
        planTier: 'end-of-day',
        state: 'live',
        note: `Latest value ${latest}`,
      });
      return {
        rows: written,
        details: { latest, skippedRows: skipped.length, fileBytes: bytes.length },
      };
    },
    () => now().getTime(),
  );
  await store.recordRun(run);
  return run;
}
