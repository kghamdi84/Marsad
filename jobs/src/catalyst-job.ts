import {
  buildCalendar,
  catalystAlert,
  lastCompletedTradingDay,
  matchScenario,
  runJob,
  type JobRunRecord,
  type SessionMove,
} from '@marsad/core';
import { alertContext, pipelineAndStore } from './alert-writer.js';
import type { Store } from './store.js';

export interface CatalystJobDeps {
  store: Store;
  now: () => Date;
}

/**
 * The catalyst watch (ADR 0030), after each bars run: every active scenario is matched against the last 26 hours
 * of 8-Ks, Form 4s, news and halts and the session's move, and each match goes through the alert pipeline as a
 * shadow alert with its confirmation, chase guard and analog count. A ticker without the session's bar is
 * matched on events only, and named.
 */
export async function runCatalystJob(deps: CatalystJobDeps): Promise<JobRunRecord> {
  const { store, now } = deps;
  const run = await runJob(
    'catalyst-watch',
    async () => {
      const at = now();
      const calendar = buildCalendar(await store.getHolidays('NYSE'), 'NYSE');
      const session = lastCompletedTradingDay(at, calendar);
      if (session === null) throw new Error('No completed trading day found');
      const scenarios = await store.getActiveScenarios(session);
      if (scenarios.length === 0) return { rows: 0, details: { scenarios: 0, session } };
      const events = await store.getCatalystEvents(
        new Date(at.getTime() - 26 * 3_600_000).toISOString(),
      );
      const moves: SessionMove[] = [];
      const noBar: string[] = [];
      for (const ticker of [...new Set(scenarios.flatMap((s) => s.tickers))]) {
        const bars = await store.getDailyBars(ticker);
        const last = bars.at(-1);
        const prev = bars.at(-2);
        if (!last || !prev || last.date !== session) {
          noBar.push(ticker);
          continue;
        }
        const window = bars.slice(-21, -1).map((b) => b.volume);
        const avg = window.length === 20 ? window.reduce((a, b) => a + b, 0) / 20 : null;
        moves.push({
          ticker,
          date: last.date,
          prevClose: prev.close,
          close: last.close,
          volumeRatio: avg && avg > 0 ? last.volume / avg : null,
        });
      }
      const context = await alertContext(store);
      const items = [];
      let matched = 0;
      for (const s of scenarios)
        for (const m of matchScenario(s, events, moves, session)) {
          matched += 1;
          const n = await store.countEightKAnalogs([m.ticker], s.triggers.eightKItems);
          const label =
            s.triggers.eightKItems.length > 0
              ? `8-K filings with item ${s.triggers.eightKItems.join(' or ')}`
              : 'comparable events';
          items.push({ input: catalystAlert(m, context, { label, n }, at), sourceAt: null });
        }
      const { rows, decisions } = await pipelineAndStore(store, items, at);
      return {
        rows,
        details: {
          session,
          scenarios: scenarios.length,
          events: events.length,
          matched,
          decisions,
          ...(noBar.length ? { noSessionBar: noBar } : {}),
        },
      };
    },
    () => now().getTime(),
  );
  await store.recordRun(run);
  return run;
}
