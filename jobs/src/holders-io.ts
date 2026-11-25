import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createClient } from '@supabase/supabase-js';
import type { HoldersStore, ThirteenFSource } from './holders-job.js';
import { supabaseStore } from './store.js';

const PAGES = [
  'https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets',
  'https://www.sec.gov/dera/data/form-13f-data-sets',
];

/** The SEC page and downloads, with the declared User-Agent; unzip streams each file (the runner has it). */
export function secThirteenFSource(userAgent: string): ThirteenFSource {
  return {
    async listDataSets() {
      for (const p of PAGES) {
        const res = await fetch(p, { headers: { 'User-Agent': userAgent } });
        if (!res.ok) continue;
        const html = await res.text();
        const links = [
          ...new Set([...html.matchAll(/href="([^"]+form13f\.zip)"/gi)].map((m) => m[1] ?? '')),
        ];
        if (links.length > 0)
          return links.map((l) => (l.startsWith('http') ? l : `https://www.sec.gov${l}`));
      }
      return [];
    },
    async download(url) {
      if (!/^https:\/\/www\.sec\.gov\/[\w/.-]+\.zip$/.test(url))
        throw new Error(`Not an SEC data set: ${url}`);
      const res = await fetch(url, { headers: { 'User-Agent': userAgent } });
      if (!res.ok || !res.body) throw new Error(`13F data set download answered ${res.status}`);
      const dir = await mkdtemp(join(tmpdir(), 'marsad-13f-'));
      const path = join(dir, 'data.zip');
      await pipeline(Readable.fromWeb(res.body as never), createWriteStream(path));
      return path;
    },
    async *lines(zip, file) {
      const child = spawn('unzip', ['-p', zip, file], { stdio: ['ignore', 'pipe', 'inherit'] });
      const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
      for await (const line of rl) yield line;
      const code: number = await new Promise((r) => child.on('close', (c) => r(c ?? 0)));
      if (code !== 0) throw new Error(`unzip ${file} exited with ${code}`);
    },
  };
}

export function supabaseHoldersStore(url: string, secretKey: string): HoldersStore {
  const db = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    async getStoredDataSet() {
      const { data, error } = await db
        .from('holders_13f_lists')
        .select('data_set, version, fetched_at')
        .order('fetched_at', { ascending: false })
        .limit(1);
      if (error) throw new Error(`holders_13f_lists read failed: ${error.message}`);
      const r = data?.[0];
      return r ? { dataSet: String(r['data_set']), version: String(r['version']) } : null;
    },
    async saveHolders(dataSet, lists) {
      let n = 0;
      for (const { ticker, list } of lists) {
        const head = await db.from('holders_13f_lists').upsert(
          {
            ticker,
            period: list.period,
            data_set: dataSet,
            version: list.version,
            filers: list.filers,
            total_shares: list.totalShares,
            total_value_usd: list.totalValueUsd,
            cusips: list.cusips,
            left_out: list.leftOut,
            fetched_at: new Date().toISOString(),
          },
          { onConflict: 'ticker,period' },
        );
        if (head.error) throw new Error(`holders_13f_lists upsert failed: ${head.error.message}`);
        const del = await db
          .from('holders_13f')
          .delete()
          .eq('ticker', ticker)
          .eq('period', list.period);
        if (del.error) throw new Error(`holders_13f delete failed: ${del.error.message}`);
        if (list.top.length === 0) continue;
        const ins = await db.from('holders_13f').insert(
          list.top.map((h, i) => ({
            ticker,
            period: list.period,
            rank: i + 1,
            filer_cik: h.cik,
            filer_name: h.name,
            shares: h.shares,
            value_usd: h.valueUsd,
            share: Math.round(h.share * 1e6) / 1e6,
            filing_date: h.filingDate || null,
          })),
        );
        if (ins.error) throw new Error(`holders_13f insert failed: ${ins.error.message}`);
        n += list.top.length;
      }
      return n;
    },
    recordRun: supabaseStore(url, secretKey).recordRun,
  };
}
