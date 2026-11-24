import {
  DEFAULT_SOURCE_POLICIES,
  SOURCE_POLICY_VERSION,
  assessSources,
  buildCalendar,
  healthTransitions,
  runJob,
  type HealthState,
  type JobRunRecord,
  type SourcePolicy,
} from '@marsad/core';
import type { Store } from './store.js';

export interface HealthJobDeps {
  store: Store;
  now: () => Date;
  policies?: readonly SourcePolicy[];
}

/**
 * The heartbeat. Judges every source against its policy and records a system alert only when a source
 * changes state (stale, or recovered), so a feed that stays down raises one alert. If the market
 * calendar does not cover today, session-dependent sources cannot be judged: the run still raises
 * alerts for what it could judge, then fails loudly so the gap is never read as calm.
 */
export async function runHealthJob(deps: HealthJobDeps): Promise<JobRunRecord> {
  const { store, now } = deps;
  const policies = deps.policies ?? DEFAULT_SOURCE_POLICIES;
  const run = await runJob(
    'health-check',
    async () => {
      const at = now();
      const [beats, holidays, events] = await Promise.all([
        store.getSourceHeartbeats(),
        store.getHolidays('NYSE'),
        store.getLatestHealthEvents(),
      ]);
      const calendar = buildCalendar(holidays, 'NYSE');
      const { health, uncheckable } = assessSources(policies, beats, at, calendar);
      const previous: Record<string, HealthState> = {};
      for (const [source, event] of Object.entries(events))
        previous[source] = event === 'stale' ? 'stale' : 'ok';
      const alerts = healthTransitions(policies, previous, health, at);
      // What each alert was decided from, so it can be replayed (integrity rule 12).
      const snapshots = alerts.map((a) => {
        const h = health.find((x) => x.source === a.source);
        const p = policies.find((x) => x.source === a.source);
        return {
          checkedAt: at.toISOString(),
          calendarCoveredThrough: calendar.coveredThrough,
          previousState: previous[a.source] ?? 'ok',
          health: h
            ? {
                state: h.state,
                session: h.session,
                silenceSec: h.silenceSec,
                lastMessageAt: h.lastMessageAt?.toISOString() ?? null,
              }
            : null,
          maxSilenceSec: p?.maxSilenceSec ?? null,
        };
      });
      const written = await store.insertSystemAlerts(alerts, SOURCE_POLICY_VERSION, snapshots);
      const states: Record<string, number> = {};
      for (const h of health) states[h.state] = (states[h.state] ?? 0) + 1;
      if (uncheckable.length > 0)
        throw new Error(
          `Market calendar does not cover today, so these sources could not be judged: ${uncheckable.join(', ')}. ${written} alert(s) raised for the rest.`,
        );
      return {
        rows: written,
        details: {
          states,
          stale: health.filter((h) => h.state === 'stale').map((h) => h.source),
          alerts: alerts.map((a) => `${a.source}:${a.event}`),
          policyVersion: SOURCE_POLICY_VERSION,
        },
      };
    },
    () => now().getTime(),
  );
  await store.recordRun(run);
  return run;
}
