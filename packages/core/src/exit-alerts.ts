/**
 * Exit alerts (ADR 0022): each holding's exit rules (stop, target, trend break, time stop) become alert inputs for
 * the pipeline when they newly hold on the newest completed bar. A rule that already held on the bar before does
 * not fire again, so a holding below its stop raises one alert, not one a day. Pure.
 */
import type { AlertInput, Priority, Reading } from './alerts.js';
import { exitSignals, type ExitSignal, type Holding } from './portfolio.js';
import type { DailyBar } from './study.js';

/** Exit alerts read stored end-of-day bars: at most 6 hours after the bars job stored them. */
export const EXIT_MAX_AGE_SECONDS = 6 * 3600;

export interface HoldingRef extends Holding {
  id: number;
}

const PRIORITY: Record<ExitSignal['kind'], Priority> = {
  stop: 'high',
  'trend-break': 'high',
  target: 'normal',
  'time-stop': 'normal',
};

const HEADLINE: Record<ExitSignal['kind'], string> = {
  stop: 'closed at or below its stop',
  'trend-break': 'closed below its trend-break average',
  target: 'reached a profit target',
  'time-stop': 'hit its time stop',
};

/** The case against acting on the exit, so the decision is made with both sides in view. */
const BEAR_FOR_SELLING: Record<ExitSignal['kind'], string> = {
  stop: 'A close below the stop can reverse the next session, and selling into a market-wide drop sells near the low. Against that: the stop was written in advance, and moving it after the fact is the habit the checklist exists to stop.',
  'trend-break':
    'Trend breaks during market-wide stress have lower follow-through, and one close below the average is often retaken. Against that: the rule was chosen when calm, and waiting for confirmation costs more if the break holds.',
  target:
    'Strong names can run well past a first target; selling the whole position caps the winner. Against that: taking part of the position at the target is the written plan, and unrealized gains are not yet profits.',
  'time-stop':
    'The thesis may simply need more time; a catalyst could still arrive. Against that: capital tied up without progress has a cost, and the time stop was set to stop hope from extending the hold.',
};

/**
 * The exit alerts for one holding on its newest bar. `fetchedAt` is when the bars were stored: the data's
 * freshness for the pipeline. End-of-day bars are labeled delayed.
 */
export function exitAlerts(
  h: HoldingRef,
  bars: readonly DailyBar[],
  context: { vix?: Reading; regime?: string },
  fetchedAt: string,
  now: Date,
): AlertInput[] {
  const last = bars.at(-1);
  if (!last || bars.length < 2) return [];
  const before = new Set(exitSignals(h, bars.slice(0, -1)).map((s) => s.kind));
  const age = Math.max(0, Math.round((now.getTime() - Date.parse(fetchedAt)) / 1000));
  return exitSignals(h, bars)
    .filter((s) => !before.has(s.kind))
    .map((s) => ({
      kind: 'exit' as const,
      priority: PRIORITY[s.kind],
      ticker: h.ticker,
      ruleId: `exit-${s.kind}`,
      ruleVersion: 1,
      ruleStatus: 'live' as const,
      eventId: `exit:${h.id}:${s.kind}:${s.date}`,
      headline: `${h.ticker} ${HEADLINE[s.kind]}`,
      trigger: s.detail,
      price: last.close,
      risk: [
        { horizon: 'scalp' as const, losses: 0, n: null },
        { horizon: 'swing' as const, losses: 0, n: null },
        { horizon: 'long' as const, losses: 0, n: null },
      ],
      context: { ...context, news: [] },
      bearCase: BEAR_FOR_SELLING[s.kind],
      sources: [
        {
          id: 'massive-daily-bars',
          label: `Massive daily bars, completed session ${s.date} (end of day)`,
          asOf: fetchedAt,
        },
      ],
      worstAgeSeconds: age,
      maxAgeSeconds: EXIT_MAX_AGE_SECONDS,
      delayed: true,
    }));
}
