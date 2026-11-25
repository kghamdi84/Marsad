import {
  ALERTS_VERSION,
  DEFAULT_ALERT_SETTINGS,
  STARTING_TICKERS,
  haltAlerts,
  pushText,
  renderCard,
  runJob,
  runPipeline,
  type JobRunRecord,
  type Reading,
} from '@marsad/core';
import type { Store, StoredAlert } from './store.js';

export interface HaltAlertsJobDeps {
  store: Store;
  now: () => Date;
}

const localDate = (d: Date, zone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);

/**
 * Turns halts and resumptions in watched tickers (the starting list and any saved watchlist) into alerts through the
 * pipeline (ADR 0019), and stores each with its input snapshot, decision and reasons. An event already stored is
 * never stored again by a later run. Delivery is recorded as not configured until Web Push exists.
 */
export async function runHaltAlertsJob(deps: HaltAlertsJobDeps): Promise<JobRunRecord> {
  const { store, now } = deps;
  const run = await runJob(
    'alerts-halts',
    async () => {
      const at = now();
      const settings = DEFAULT_ALERT_SETTINGS;
      const watched = new Set([...STARTING_TICKERS, ...(await store.getWatchlistTickers())]);
      const halts = (
        await store.getRecentHalts(new Date(at.getTime() - 12 * 3_600_000).toISOString())
      ).filter((h) => watched.has(h.symbol));
      const regime = (await store.latest('regime_daily', 'date, label', 'date', 1))[0];
      const vixRow = (
        await store.latest('fred_observations', 'date, value|series_id=VIXCLS', 'date', 5)
      ).find((r) => r['value'] !== null && r['value'] !== undefined);
      const vix: Reading | undefined = vixRow
        ? {
            value: Number(vixRow['value']),
            asOf: String(vixRow['date']),
            source: 'FRED VIXCLS',
            delayed: true,
          }
        : undefined;
      const recent = await store.getRecentAlerts(
        new Date(at.getTime() - 24 * 3_600_000).toISOString(),
      );
      const today = localDate(at, settings.timeZone);
      const state = {
        recent: recent.map((r) => ({ key: r.key, at: r.at })),
        pushesToday: recent.filter(
          (r) => r.decision === 'push' && localDate(new Date(r.at), settings.timeZone) === today,
        ).length,
      };
      const rows: StoredAlert[] = [];
      const decisions: Record<string, number> = {};
      for (const h of halts)
        for (const input of haltAlerts(
          h,
          { ...(vix ? { vix } : {}), ...(regime ? { regime: String(regime['label']) } : {}) },
          at,
        )) {
          const r = runPipeline(input, settings, state, at);
          // One stored row per event: a later run never stores the same event again, whatever it decides now.
          if (state.recent.some((x) => x.key === r.key)) continue;
          state.recent.push({ key: r.key, at: at.toISOString() });
          if (r.decision === 'push') state.pushesToday += 1;
          decisions[r.decision] = (decisions[r.decision] ?? 0) + 1;
          rows.push({
            version: ALERTS_VERSION,
            input,
            key: r.key,
            decision: r.decision,
            reasons: r.reasons,
            card: renderCard(input),
            push: pushText(input),
            sourceAt: input.eventId?.startsWith('resume:') ? h.resumptionTradeAt : h.lastSeenAt,
            createdAt: at.toISOString(),
            delivery: {
              push: 'not-configured (Web Push arrives with Phase 5 delivery)',
              email: 'not-configured',
            },
          });
        }
      const written = await store.insertAlerts(rows);
      return { rows: written, details: { watched: watched.size, halts: halts.length, decisions } };
    },
    () => now().getTime(),
  );
  await store.recordRun(run);
  return run;
}
