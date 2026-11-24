import {
  TOLERANCES,
  buildReport,
  compareValues,
  fetchTreasuryYields,
  runJob,
  type CheckResult,
  type FredObservation,
  type HttpClient,
  type JobRunRecord,
  type MassiveConfig,
} from '@marsad/core';
import type { Store } from './store.js';

export interface ReconcileDeps {
  http: HttpClient;
  cfg: MassiveConfig;
  store: Store;
  now: () => Date;
  lookbackDays?: number;
}

function byDate(obs: readonly FredObservation[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const o of obs) if (o.value !== null) m.set(o.date, o.value);
  return m;
}

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Compares Massive's Treasury yields with FRED for every recent date both sources published: the
 * 10-year yield, and the 10y-3m and 10y-2y spreads against FRED's own spread series. Any disagreement
 * beyond tolerance, or nothing to compare at all, makes the run an error so it cannot pass silently.
 */
export async function runReconcileJob(deps: ReconcileDeps): Promise<JobRunRecord> {
  const { store, now, http, cfg } = deps;
  const run = await runJob(
    'reconcile-nightly',
    async () => {
      const to = isoDate(now());
      const from = isoDate(new Date(now().getTime() - (deps.lookbackDays ?? 10) * 86_400_000));
      const yields = await fetchTreasuryYields(http, cfg, from, to);
      if (!yields.ok)
        throw new Error(`Massive yields unavailable: ${yields.display} (${yields.kind})`);
      const [dgs10, t10y3m, t10y2y] = await Promise.all([
        store.getFredRange('DGS10', from, to),
        store.getFredRange('T10Y3M', from, to),
        store.getFredRange('T10Y2Y', from, to),
      ]);
      const f10 = byDate(dgs10);
      const f3m = byDate(t10y3m);
      const f2y = byDate(t10y2y);
      const checks: CheckResult[] = [];
      const compared: string[] = [];
      for (const day of yields.data.value ?? []) {
        const fred10 = f10.get(day.date);
        if (fred10 === undefined || day.y10y === null) continue; // not published by both: nothing to compare
        compared.push(day.date);
        checks.push(
          compareValues(
            `10y yield ${day.date}`,
            { label: 'Massive 10y', value: day.y10y },
            { label: 'FRED DGS10', value: fred10 },
            { abs: TOLERANCES.yieldAbs },
          ),
        );
        const s3 = f3m.get(day.date);
        if (s3 !== undefined && day.y3m !== null) {
          checks.push(
            compareValues(
              `10y-3m spread ${day.date}`,
              { label: 'Massive 10y-3m', value: Number((day.y10y - day.y3m).toFixed(4)) },
              { label: 'FRED T10Y3M', value: s3 },
              { abs: TOLERANCES.yieldAbs },
            ),
          );
        }
        const s2 = f2y.get(day.date);
        if (s2 !== undefined && day.y2y !== null) {
          checks.push(
            compareValues(
              `10y-2y spread ${day.date}`,
              { label: 'Massive 10y-2y', value: Number((day.y10y - day.y2y).toFixed(4)) },
              { label: 'FRED T10Y2Y', value: s2 },
              { abs: TOLERANCES.yieldAbs },
            ),
          );
        }
      }
      if (checks.length === 0)
        throw new Error('Nothing to reconcile: no date has both Massive and FRED yields');
      const report = buildReport(checks, now());
      if (report.failed.length > 0) {
        throw new Error(
          `Reconciliation mismatch: ${report.failed.map((c) => `${c.name} (${c.detail})`).join('; ')}`.slice(
            0,
            480,
          ),
        );
      }
      return { rows: checks.length, details: { checks: checks.length, dates: compared } };
    },
    () => now().getTime(),
  );
  await store.recordRun(run);
  return run;
}
