/**
 * Halt alerts (ADR 0019): a trading halt or resumption in a watched ticker becomes an alert input with the exchange
 * notice as a tier-1 source. Pure: the job passes the stored halt and the context.
 */
import type { AlertInput, Reading } from './alerts.js';
import { dualClock } from './time.js';

export interface HaltRow {
  symbol: string;
  haltedAt: string;
  reasonCode: string;
  reasonMeaning: string | null;
  newsRelated: boolean;
  resumptionTradeAt: string | null;
  /** When the halts feed last showed this row: the data's freshness, not the halt's age. */
  lastSeenAt: string;
}

const BEAR =
  'A halt freezes price discovery; the reopening can gap far from the last trade. No entry at the reopen without reading the news and a written plan.';

/** The halt itself, and (when a resumption time is published) the resumption, as separate events. */
export function haltAlerts(
  h: HaltRow,
  context: { vix?: Reading; regime?: string },
  now: Date,
  localZone = 'Asia/Riyadh',
): AlertInput[] {
  const at = dualClock(new Date(h.haltedAt), localZone);
  const reason = h.reasonMeaning ? `${h.reasonCode} (${h.reasonMeaning})` : h.reasonCode;
  const age = Math.max(0, Math.round((now.getTime() - Date.parse(h.lastSeenAt)) / 1000));
  const common = {
    kind: 'halt' as const,
    ticker: h.symbol,
    ruleId: 'halts',
    ruleVersion: 1,
    ruleStatus: 'live' as const,
    risk: [
      { horizon: 'scalp' as const, losses: 0, n: null },
      { horizon: 'swing' as const, losses: 0, n: null },
      { horizon: 'long' as const, losses: 0, n: null },
    ],
    context: { ...context, news: [] },
    bearCase: BEAR,
    sources: [
      {
        id: 'nasdaq-halts',
        label: 'Nasdaq Trader trade halts feed (exchange notice, tier 1)',
        asOf: h.haltedAt,
      },
    ],
    delayed: false,
  };
  const out: AlertInput[] = [
    {
      ...common,
      // News-related halts are critical: the exchange notice is a tier-1 source.
      priority: h.newsRelated ? 'critical' : 'high',
      eventId: `halt:${h.haltedAt}`,
      headline: `${h.symbol} halted: ${h.reasonMeaning ?? h.reasonCode}`,
      trigger: `Trading halted at ${at.label}, reason ${reason}.`,
      worstAgeSeconds: age,
    },
  ];
  if (h.resumptionTradeAt) {
    const r = dualClock(new Date(h.resumptionTradeAt), localZone);
    out.push({
      ...common,
      priority: 'high',
      eventId: `resume:${h.resumptionTradeAt}`,
      headline: `${h.symbol} resumes trading`,
      trigger: `Trading resumes at ${r.label} after the ${at.label} halt (${reason}).`,
      worstAgeSeconds: age,
    });
  }
  return out;
}
