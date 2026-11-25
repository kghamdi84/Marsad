import {
  CAPITULATION_VERSION,
  FEAR_GREED_VERSION,
  capitulationAlert,
  capitulationHistory,
  capitulationTriggers,
  episodeLosses,
  fearGreedHistory,
  runJob,
  stagedPlan,
  type JobRunRecord,
  type Obs,
  type RecessionLevel,
  type StagedPlan,
} from '@marsad/core';
import { alertContext, pipelineAndStore } from './alert-writer.js';
import { CAPITULATION_PROXY } from './regime-job.js';
import type { Store } from './store.js';

/** A trigger older than this many calendar days is history, never a new alert (backfills and late runs). */
export const CAPITULATION_ALERT_MAX_DAYS = 4;
/** The event-study horizon the alert quotes (the brief's example: 63 sessions). */
export const CAPITULATION_ALERT_HORIZON = 63;

export interface SentimentJobDeps {
  store: Store;
  now: () => Date;
}

/** A newest composite older than this many calendar days fails the run: silence must not look like calm. */
export const MAX_COMPOSITE_AGE_DAYS = 5;

const FROM = '2014-01-01';
const LEVELS = new Set(['low', 'elevated', 'high', 'unavailable']);

async function fred(store: Store, id: string, to: string): Promise<Obs[]> {
  return (await store.getFredRange(id, FROM, to)).filter((o): o is Obs => o.value !== null);
}

/**
 * Recomputes the Fear and Greed composite and the capitulation watch for every day from stored data (FRED series,
 * Marsad universe breadth, SPY and IEF daily bars, the stored recession filter), and re-evaluates the staged-entry
 * plan of every capitulation episode (ADR 0011). Reads only the database; run it after the FRED, regime, bars and
 * breadth jobs (it runs after the FRED and the breadth workflows, so each new input shows up the same day).
 */
export async function runSentimentJob(deps: SentimentJobDeps): Promise<JobRunRecord> {
  const { store, now } = deps;
  const run = await runJob(
    'sentiment-daily',
    async () => {
      const today = now().toISOString().slice(0, 10);
      const sp500 = await fred(store, 'SP500', today);
      if (sp500.length === 0) throw new Error('No stored S&P 500 history. Run the FRED job first.');
      const vix = await fred(store, 'VIXCLS', today);
      const highYield = await fred(store, 'BAMLH0A0HYM2', today);
      const investmentGrade = await fred(store, 'BAMLC0A0CM', today);
      const breadth = await store.getBreadthInputs(FROM);
      const spyBars = await store.getDailyCloses('SPY');
      const iefBars = await store.getDailyCloses('IEF');
      const toObs = (b: { date: string; close: number }[]) =>
        b.map((x) => ({ date: x.date, value: x.close }));

      const days = fearGreedHistory({
        sp500,
        vix,
        highYield,
        investmentGrade,
        breadth,
        spy: toObs(spyBars),
        ief: toObs(iefBars),
      });
      const written = await store.upsertFearGreedDays(days);

      const recession = new Map<string, RecessionLevel>(
        (await store.getRecessionLevels(FROM)).flatMap((r) =>
          LEVELS.has(r.level) ? [[r.date, r.level as RecessionLevel] as const] : [],
        ),
      );
      const capDays = capitulationHistory(
        days.map((d) => d.date),
        vix,
        new Map(breadth.map((b) => [b.date, { above50: b.above50, n50: b.n50 }])),
        new Map(days.map((d) => [d.date, d.composite])),
        recession,
      );
      await store.upsertCapitulationDays(capDays);
      const plans = capitulationTriggers(capDays).flatMap((t): StagedPlan[] => {
        const p = stagedPlan(t, spyBars, recession);
        return p ? [p] : [];
      });
      await store.upsertCapitulationPlans(plans);

      // 3.10: the regime alert when the watch turns on. Only a trigger at most a few days old and still on today;
      // the alert's event key is the trigger date, so later runs never store it twice.
      // The newest day with every input: FRED publishes the VIX close the next morning, while breadth and bars
      // arrive the same evening, so the newest day is often 'unavailable' for a few hours.
      const lastDay = [...capDays].reverse().find((d) => d.state !== 'unavailable');
      const triggerDate = capitulationTriggers(capDays).at(-1);
      let alert: Record<string, number> | null = null;
      const triggerAge =
        triggerDate === undefined
          ? Infinity
          : (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${triggerDate}T00:00:00Z`)) /
            86_400_000;
      if (lastDay?.state === 'on' && triggerAge <= CAPITULATION_ALERT_MAX_DAYS) {
        const day = capDays.find((d) => d.date === triggerDate) ?? lastDay;
        const row = (
          await store.latest(
            'regime_event_stats',
            `horizon, n, median, q1, q3, data_from, episodes|condition=${CAPITULATION_PROXY}`,
            'horizon',
            20,
          )
        ).find((r) => Number(r['horizon']) === CAPITULATION_ALERT_HORIZON);
        const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
        const study = row
          ? {
              horizon: CAPITULATION_ALERT_HORIZON,
              n: Number(row['n']),
              median: num(row['median']),
              q1: num(row['q1']),
              q3: num(row['q3']),
              dataFrom: String(row['data_from']),
              episodes: (row['episodes'] ?? []) as string[],
            }
          : null;
        const at = now();
        const input = capitulationAlert(
          day,
          plans.find((p) => p.triggerDate === day.date) ?? null,
          study
            ? {
                ...study,
                losses: episodeLosses(sp500, study.episodes, CAPITULATION_ALERT_HORIZON),
              }
            : null,
          await alertContext(store),
          at,
          at,
        );
        alert = (await pipelineAndStore(store, [{ input, sourceAt: null }], at)).decisions;
      }

      const latest = [...days].reverse().find((d) => d.composite !== null);
      const newest = days.at(-1);
      const cap = capDays.at(-1);
      const details = {
        versions: [FEAR_GREED_VERSION, CAPITULATION_VERSION],
        days: days.length,
        latest: latest?.date ?? null,
        composite:
          latest?.composite === null || latest === undefined ? null : Math.round(latest.composite),
        label: latest?.label ?? null,
        available: latest?.available ?? null,
        newestDay: newest?.date ?? null,
        newestAvailable: newest?.available ?? null,
        capitulation: cap ? `${cap.state} on ${cap.date}` : null,
        episodes: plans.length,
        ...(alert ? { capitulationAlert: alert } : {}),
        inputs: {
          breadthDays: breadth.length,
          spyBars: spyBars.length,
          iefBars: iefBars.length,
        },
      };
      if (!latest)
        throw new Error(
          `No day has 4 of 7 components yet (newest ${newest?.date ?? 'none'}: ${newest?.available ?? 0} of 7). Breadth needs its backfill, and SPY and IEF need two years of bars.`,
        );
      const age =
        (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${latest.date}T00:00:00Z`)) / 86_400_000;
      if (age > MAX_COMPOSITE_AGE_DAYS)
        throw new Error(
          `The newest composite is ${latest.date} (${age} days old); an input job may not be running. ${JSON.stringify(details.inputs)}`,
        );
      return { rows: written, details };
    },
    () => now().getTime(),
  );
  await store.recordRun(run);
  return run;
}
