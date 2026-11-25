/**
 * Weekly exports (ADR 0026, `exports-1`): Khaled's journal, holdings, theses, watchlists, feedback and the rule
 * library as JSON files in a private Storage bucket, one folder per week, with a manifest of row counts and
 * content hashes so a restore can be checked. Pure: the job reads the rows and uploads the files.
 */
export const EXPORTS_VERSION = 'exports-1';

/** Personal tables (rows filtered by owner) and the shared rule tables every export carries. */
export const PERSONAL_EXPORT_TABLES = [
  'holdings',
  'trades',
  'theses',
  'watchlists',
  'watchlist_items',
  'alert_feedback',
  'user_settings',
] as const;
export const SHARED_EXPORT_TABLES = ['rules', 'rule_events', 'backtest_runs'] as const;

/** FNV-1a 32-bit hash of a string, as 8 hex digits. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export interface ExportFile {
  path: string;
  body: string;
}

export interface ExportManifest {
  version: string;
  ownerId: string;
  /** The export's date (UTC), also its folder. */
  date: string;
  createdAt: string;
  tables: { name: string; rows: number; chars: number; fnv1a: string }[];
}

/** The files of one owner's export: one JSON file per table, then `manifest.json`. */
export function buildExport(
  ownerId: string,
  createdAt: Date,
  tables: Readonly<Record<string, readonly unknown[]>>,
): { files: ExportFile[]; manifest: ExportManifest } {
  const date = createdAt.toISOString().slice(0, 10);
  const folder = `${ownerId}/${date}`;
  const names = Object.keys(tables).sort();
  const files = names.map((name) => ({
    path: `${folder}/${name}.json`,
    body: `${JSON.stringify(tables[name], null, 1)}\n`,
  }));
  const manifest: ExportManifest = {
    version: EXPORTS_VERSION,
    ownerId,
    date,
    createdAt: createdAt.toISOString(),
    tables: names.map((name, i) => {
      const body = (files[i] as ExportFile).body;
      return {
        name,
        rows: (tables[name] as readonly unknown[]).length,
        chars: body.length,
        fnv1a: fnv1a(body),
      };
    }),
  };
  files.push({ path: `${folder}/manifest.json`, body: `${JSON.stringify(manifest, null, 1)}\n` });
  return { files, manifest };
}
