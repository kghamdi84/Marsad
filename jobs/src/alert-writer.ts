import {
  ALERTS_VERSION,
  DEFAULT_ALERT_SETTINGS,
  pushText,
  renderCard,
  runPipeline,
  type AlertInput,
  type AlertSettings,
  type Reading,
} from '@marsad/core';
import type { Store, StoredAlert } from './store.js';

const localDate = (d: Date, zone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);

/** The context every alert card shows: the newest regime label and VIX close (FRED, delayed). */
export async function alertContext(store: Store): Promise<{ vix?: Reading; regime?: string }> {
  const regime = (await store.latest('regime_daily', 'date, label', 'date', 1))[0];
  const vixRow = (
    await store.latest('fred_observations', 'date, value|series_id=VIXCLS', 'date', 5)
  ).find((r) => r['value'] !== null && r['value'] !== undefined);
  return {
    ...(vixRow
      ? {
          vix: {
            value: Number(vixRow['value']),
            asOf: String(vixRow['date']),
            source: 'FRED VIXCLS',
            delayed: true,
          },
        }
      : {}),
    ...(regime ? { regime: String(regime['label']) } : {}),
  };
}

/**
 * Runs alert inputs through the pipeline (ADR 0019) and stores each new event once, with its input snapshot,
 * decision and reasons. An event already stored (by key) is never stored again by a later run, whatever the
 * pipeline would decide now. Push decisions are stored as pending for the Web Push dispatcher.
 */
export async function pipelineAndStore(
  store: Store,
  items: readonly { input: AlertInput; sourceAt: string | null }[],
  at: Date,
  settings: AlertSettings = DEFAULT_ALERT_SETTINGS,
): Promise<{ rows: number; decisions: Record<string, number> }> {
  const recent = await store.getRecentAlerts(new Date(at.getTime() - 24 * 3_600_000).toISOString());
  const today = localDate(at, settings.timeZone);
  const state = {
    recent: recent.map((r) => ({ key: r.key, at: r.at })),
    pushesToday: recent.filter(
      (r) => r.decision === 'push' && localDate(new Date(r.at), settings.timeZone) === today,
    ).length,
  };
  const rows: StoredAlert[] = [];
  const decisions: Record<string, number> = {};
  for (const { input, sourceAt } of items) {
    const r = runPipeline(input, settings, state, at);
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
      sourceAt,
      createdAt: at.toISOString(),
      // Only push decisions wait for the Web Push dispatcher (ADR 0031); the rest are never pushed.
      delivery: {
        push: r.decision === 'push' ? 'pending' : `not sent (${r.decision})`,
        email: 'not-configured',
      },
    });
  }
  return { rows: await store.insertAlerts(rows), decisions };
}
