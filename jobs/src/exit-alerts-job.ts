import {
  buildCalendar,
  exitAlerts,
  lastCompletedTradingDay,
  runJob,
  type JobRunRecord,
} from '@marsad/core';
import { alertContext, pipelineAndStore } from './alert-writer.js';
import type { Store } from './store.js';

export interface ExitAlertsJobDeps {
  store: Store;
  now: () => Date;
}

/**
 * Checks every open holding's exit rules on its newest completed bar (ADR 0022) and sends the rules that newly
 * hold through the alert pipeline. Runs after the bars job. A holding whose bars are missing or older than the
 * last completed session is named and the run fails after storing the rest: a silent gap must never look like
 * "no exit".
 */
export async function runExitAlertsJob(deps: ExitAlertsJobDeps): Promise<JobRunRecord> {
  const { store, now } = deps;
  const run = await runJob(
    'alerts-exits',
    async () => {
      const at = now();
      const calendar = buildCalendar(await store.getHolidays('NYSE'), 'NYSE');
      const lastDay = lastCompletedTradingDay(at, calendar);
      if (lastDay === null)
        throw new Error('No completed trading day found, cannot tell which bar is the newest');
      const holdings = await store.getOpenHoldings();
      const context = await alertContext(store);
      const items: Parameters<typeof pipelineAndStore>[1][number][] = [];
      const problems: string[] = [];
      for (const h of holdings) {
        const bars = await store.getDailyBars(h.ticker);
        const last = bars.at(-1);
        if (!last) {
          problems.push(`${h.ticker}: no stored bars`);
          continue;
        }
        if (last.date < lastDay) {
          problems.push(`${h.ticker}: newest bar ${last.date}, expected ${lastDay}`);
          continue;
        }
        const fetchedAt = (await store.getBarsFetchedAt(h.ticker)) ?? at.toISOString();
        for (const input of exitAlerts(h, bars, context, fetchedAt, at))
          items.push({ input, sourceAt: fetchedAt });
      }
      const { rows, decisions } = await pipelineAndStore(store, items, at);
      if (problems.length > 0)
        throw new Error(
          `Exit rules not checked for ${problems.join('; ')}. ${rows} alert(s) stored for the rest.`.slice(
            0,
            480,
          ),
        );
      return {
        rows,
        details: { holdings: holdings.length, session: lastDay, signals: items.length, decisions },
      };
    },
    () => now().getTime(),
  );
  await store.recordRun(run);
  return run;
}
