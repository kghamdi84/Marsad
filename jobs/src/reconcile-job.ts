import {
  TOLERANCES,
  buildCalendar,
  buildReport,
  compareValues,
  etDate,
  fetchDailyBars,
  fetchMinuteBars,
  fetchTreasuryYields,
  lastCompletedTradingDay,
  reconcileVwap,
  runJob,
  volumeWeightedPrice,
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

/** The ticker and number of completed sessions whose VWAP is rebuilt from minute bars each night. */
const VWAP_TICKER = 'SPY';
const VWAP_SESSIONS = 3;

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
      // VWAP: the vendor's daily VWAP against the volume-weighted average of its own minute VWAPs. A typical
      // price (high+low+close)/3 is not used: on SPY it drifted up to 0.41% from the vendor VWAP on a 4.6%
      // range day, far beyond the 0.1% tolerance, while the minute VWAPs stayed within 0.074% on 5 days.
      const vwapDates: string[] = [];
      const calendar = buildCalendar(await store.getHolidays('NYSE'), 'NYSE');
      const lastDay = lastCompletedTradingDay(now(), calendar);
      const daily = await fetchDailyBars(
        http,
        cfg,
        VWAP_TICKER,
        isoDate(new Date(now().getTime() - 14 * 86_400_000)),
        to,
      );
      if (!daily.ok)
        throw new Error(`Massive daily bars unavailable: ${daily.display} (${daily.kind})`);
      const completed = (daily.data.value ?? [])
        .map((b) => ({ date: etDate(new Date(b.t)), vw: b.vw ?? null }))
        .filter((b) => lastDay !== null && b.date <= lastDay)
        .slice(-VWAP_SESSIONS);
      if (completed.length === 0)
        checks.push(
          compareValues(
            `VWAP ${VWAP_TICKER}`,
            { label: 'Massive daily VWAP', value: null },
            { label: 'Massive minute VWAP', value: null },
            { rel: TOLERANCES.vwapRel },
          ),
        );
      for (const day of completed) {
        const minutes = await fetchMinuteBars(http, cfg, VWAP_TICKER, day.date);
        const computed = minutes.ok
          ? volumeWeightedPrice(
              (minutes.data.value ?? []).map((b) => b.vw ?? Number.NaN),
              (minutes.data.value ?? []).map((b) => b.v),
            )
          : null;
        vwapDates.push(day.date);
        const check = reconcileVwap(
          day.vw,
          computed === null || Number.isNaN(computed) ? null : computed,
        );
        checks.push({
          ...check,
          name: `VWAP ${VWAP_TICKER} ${day.date}`,
          // Say why the minute side is missing instead of a bare "missing".
          detail: minutes.ok
            ? check.detail
            : `minute bars unavailable: ${minutes.display} (${minutes.kind})`,
        });
      }
      const report = buildReport(checks, now());
      if (report.failed.length > 0) {
        throw new Error(
          `Reconciliation mismatch: ${report.failed.map((c) => `${c.name} (${c.detail})`).join('; ')}`.slice(
            0,
            480,
          ),
        );
      }
      return {
        rows: checks.length,
        details: { checks: checks.length, dates: compared, vwapDates },
      };
    },
    () => now().getTime(),
  );
  await store.recordRun(run);
  return run;
}
