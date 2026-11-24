import {
  STARTING_TICKERS,
  fetchDividends,
  fetchShortInterest,
  fetchShortVolume,
  runJob,
  type HttpClient,
  type JobRunRecord,
  type MassiveConfig,
} from '@marsad/core';
import type { Store } from './store.js';

export interface StudyDataJobDeps {
  http: HttpClient;
  cfg: MassiveConfig;
  store: Store;
  now: () => Date;
  tickers?: readonly string[];
}

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);
const ago = (now: Date, days: number): string =>
  isoDate(new Date(now.getTime() - days * 86_400_000));

/**
 * Short interest (twice a month, with a lag), short volume (daily; not short interest) and dividends for each
 * tracked ticker. An empty answer is normal for an ETF or a company that pays no dividend; a failed request is
 * named and makes the run an error.
 */
export async function runStudyDataJob(deps: StudyDataJobDeps): Promise<JobRunRecord> {
  const { store, now, http, cfg } = deps;
  const tickers = deps.tickers ?? STARTING_TICKERS;
  const run = await runJob(
    'massive-study-data',
    async () => {
      const started = now().getTime();
      const failed: string[] = [];
      const counts = { shortInterest: 0, shortVolume: 0, dividends: 0 };
      for (const t of tickers) {
        const si = await fetchShortInterest(http, cfg, t, ago(now(), 365));
        if (si.ok)
          counts.shortInterest += await store.upsertShortInterest(si.data.value ?? [], now());
        else failed.push(`short interest ${t}: ${si.display} (${si.kind})`);
        const sv = await fetchShortVolume(http, cfg, t, ago(now(), 120));
        if (sv.ok) counts.shortVolume += await store.upsertShortVolume(sv.data.value ?? [], now());
        else failed.push(`short volume ${t}: ${sv.display} (${sv.kind})`);
        const dv = await fetchDividends(http, cfg, t, ago(now(), 3 * 365));
        if (dv.ok) counts.dividends += await store.upsertDividends(dv.data.value ?? [], now());
        else failed.push(`dividends ${t}: ${dv.display} (${dv.kind})`);
      }
      if (failed.length > 0)
        throw new Error(`Study data failed: ${failed.join('; ')}`.slice(0, 480));
      await store.updateSourceStatus({
        source: 'massive_study',
        lastMessageAt: now(),
        latencyMs: now().getTime() - started,
        planTier: 'end-of-day',
        state: 'live',
        note: `${tickers.length} tickers: ${counts.shortInterest} short interest, ${counts.shortVolume} short volume, ${counts.dividends} dividends`,
      });
      return {
        rows: counts.shortInterest + counts.shortVolume + counts.dividends,
        details: { tickers: tickers.length, ...counts },
      };
    },
    () => now().getTime(),
  );
  await store.recordRun(run);
  return run;
}
