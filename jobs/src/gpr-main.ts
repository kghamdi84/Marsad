/**
 * Entry point for the GPR job (run by GitHub Actions). Reads SUPABASE_URL and SUPABASE_SECRET_KEY
 * from the environment; never logs them.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { runGprJob } from './gpr-job.js';
import { supabaseStore } from './store.js';

const exec = promisify(execFile);

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

const store = supabaseStore(need('SUPABASE_URL'), need('SUPABASE_SECRET_KEY'));

const run = await runGprJob({
  store,
  now: () => new Date(),
  async download(url) {
    const res = await fetch(url, { headers: { 'User-Agent': 'Marsad-gpr-job' } });
    if (!res.ok) throw new Error(`GPR download failed: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  },
  async convert(xls) {
    const dir = await mkdtemp(join(tmpdir(), 'gpr-'));
    try {
      const file = join(dir, 'gpr.xls');
      await writeFile(file, xls);
      const script = join(import.meta.dirname, '..', 'scripts', 'xls_to_json.py');
      const { stdout } = await exec('python3', ['-I', script, file], {
        maxBuffer: 64 * 1024 * 1024,
      });
      return JSON.parse(stdout) as Record<string, unknown>[];
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
});

console.log(
  `gpr-daily: ${run.status}, rows ${run.rows_written ?? 0}, ${run.latency_ms} ms${run.error ? `, error: ${run.error}` : ''}`,
);
if (run.status === 'error') process.exitCode = 1;
