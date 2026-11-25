import {
  EXPORTS_VERSION,
  PERSONAL_EXPORT_TABLES,
  SHARED_EXPORT_TABLES,
  buildExport,
  runJob,
  type JobRunRecord,
} from '@marsad/core';
import type { Store } from './store.js';

export interface ExportsJobDeps {
  store: Store;
  now: () => Date;
}

/**
 * Writes each owner's weekly export (ADR 0026): their personal rows (holdings, trades, theses, watchlists,
 * feedback, settings) and the shared rule library, as JSON files and a manifest under `<owner>/<date>/` in the
 * private exports bucket. Owners come from the personal rows themselves.
 */
export async function runExportsJob(deps: ExportsJobDeps): Promise<JobRunRecord> {
  const { store, now } = deps;
  const run = await runJob(
    'exports',
    async () => {
      const at = now();
      const personal: Record<string, Record<string, unknown>[]> = {};
      for (const t of PERSONAL_EXPORT_TABLES) personal[t] = await store.exportRows(t);
      const shared: Record<string, Record<string, unknown>[]> = {};
      for (const t of SHARED_EXPORT_TABLES) shared[t] = await store.exportRows(t);
      const owners = [
        ...new Set(
          Object.values(personal)
            .flat()
            .map((r) => r['owner_id'])
            .filter((o): o is string => typeof o === 'string'),
        ),
      ].sort();
      let files = 0;
      const rows: Record<string, number> = {};
      for (const owner of owners) {
        const tables: Record<string, unknown[]> = { ...shared };
        for (const t of PERSONAL_EXPORT_TABLES)
          tables[t] = (personal[t] ?? []).filter((r) => r['owner_id'] === owner);
        const ex = buildExport(owner, at, tables);
        for (const f of ex.files) await store.uploadExport(f.path, f.body);
        files += ex.files.length;
        for (const tb of ex.manifest.tables) rows[tb.name] = (rows[tb.name] ?? 0) + tb.rows;
      }
      return {
        rows: files,
        details: { owners: owners.length, files, rows, version: EXPORTS_VERSION },
      };
    },
    () => now().getTime(),
  );
  await store.recordRun(run);
  return run;
}
