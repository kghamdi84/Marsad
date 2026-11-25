/**
 * The signal-to-alert pipeline and the alert card (ADR 0019, `alerts-1`): gates (data fresh, rule live, liquidity,
 * chase guard, event risk), dedupe and cooldown, priority, quiet hours, per-kind toggles, per-ticker snooze and the
 * daily push cap, then the card in the brief's order and the push text. Code decides; nothing here calls a model.
 * Pure: the caller passes the state (recent alerts, push count) and the settings.
 */
import { wilson, MIN_CASES, quantileSorted } from './stats.js';
import { toFixedHalfUp } from './ai/template.js';

export const ALERTS_VERSION = 'alerts-1';

export type AlertKind =
  | 'setup'
  | 'opportunity'
  | 'options'
  | 'catalyst'
  | 'regime'
  | 'exit'
  | 'rotation'
  | 'halt'
  | 'system';
export type Priority = 'critical' | 'high' | 'normal' | 'digest';

export interface Reading {
  value: number | string;
  change?: number;
  asOf: string;
  source: string;
  delayed: boolean;
}

export interface RiskRow {
  horizon: 'scalp' | 'swing' | 'long';
  /** Losses and trades of this rule over the horizon; null n means the horizon does not apply. */
  losses: number;
  n: number | null;
}

export interface AlertInput {
  kind: AlertKind;
  priority: Priority;
  ticker?: string;
  ruleId: string;
  ruleVersion: number;
  ruleStatus: 'shadow' | 'live';
  /** For event alerts (a halt, a filing): dedupe on this event only, with no cooldown. */
  eventId?: string;
  headline: string;
  trigger: string;
  /** Price when the signal fired, and the price now (for the chase guard). */
  signalPrice?: number;
  price?: number;
  /** Most the price may have run past the signal price, as a fraction (0.03 is 3%). */
  chaseLimit?: number;
  /** Dollar volume of the last session, for the liquidity gate. */
  dollarVolume?: number;
  plan?: {
    entry: string;
    /** Absent for a written plan without a price level (a catalyst scenario). */
    stop?: number;
    targets?: number[];
    invalidation: string;
  };
  risk: RiskRow[];
  context: {
    vix?: Reading;
    fearGreed?: Reading;
    regime?: string;
    nextEvent?: { name: string; at: string; impact: 'high' | 'medium' };
    news?: { id: string; title: string; tier: 1 | 2 | 3 | 4 }[];
  };
  checklist?: {
    cleanSetup: boolean;
    notExtended: boolean;
    riskDefined: boolean;
    profitPlan: boolean;
    bearCaseRead: boolean;
  };
  bearCase: string;
  sources: { id: string; label: string; asOf: string }[];
  /** Age of the oldest input, in seconds. */
  worstAgeSeconds: number;
  /**
   * Oldest input age allowed for this input, overriding the per-priority setting. Only for end-of-day inputs
   * (exit rules on completed bars), whose data can never be minutes old; the age is then measured from when the
   * bars were stored, and the card says the data is delayed.
   */
  maxAgeSeconds?: number;
  delayed: boolean;
}

export interface AlertSettings {
  /** Kinds that may be pushed; others go to the digest. System alerts are always on. */
  enabledKinds: AlertKind[];
  /** Quiet hours in the local zone, as "HH:MM" (start may be after end, across midnight). */
  quietStart: string;
  quietEnd: string;
  timeZone: string;
  /** Most pushes a local day; the rest go to the digest. */
  dailyPushCap: number;
  /** Ticker snoozes until an instant. */
  snoozed: Record<string, string>;
  /** Minimum last-session dollar volume for setup, opportunity and rotation alerts. */
  minDollarVolume: number;
  /** Minutes before a high-impact event during which new setups are held to the digest. */
  eventBlackoutMinutes: number;
  /** Cooldown per kind, ticker and rule, in minutes. */
  cooldownMinutes: number;
  /** Oldest input age allowed, seconds, by priority. */
  maxAgeSeconds: Record<Priority, number>;
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  enabledKinds: [
    'setup',
    'opportunity',
    'options',
    'catalyst',
    'regime',
    'exit',
    'rotation',
    'halt',
    'system',
  ],
  quietStart: '23:00',
  quietEnd: '07:00',
  timeZone: 'Asia/Riyadh',
  dailyPushCap: 8,
  snoozed: {},
  minDollarVolume: 5_000_000,
  eventBlackoutMinutes: 30,
  cooldownMinutes: 240,
  maxAgeSeconds: { critical: 120, high: 300, normal: 900, digest: 86_400 },
};

export interface PipelineState {
  /** Recent alerts: their dedupe keys and when they were created. */
  recent: { key: string; at: string }[];
  /** Pushes already sent this local day. */
  pushesToday: number;
}

export type Decision = 'push' | 'digest' | 'shadow' | 'suppress';

export interface PipelineResult {
  decision: Decision;
  key: string;
  /** Every gate's outcome, in order, in plain words. */
  reasons: string[];
}

/** The dedupe key: kind, ticker and rule, per local day. */
export function dedupeKey(
  a: Pick<AlertInput, 'kind' | 'ticker' | 'ruleId'> & { eventId?: string | undefined },
  localDate: string,
): string {
  return `${a.kind}|${a.ticker ?? '-'}|${a.ruleId}|${a.eventId ?? localDate}`;
}

function localParts(instant: Date, timeZone: string): { date: string; minutes: number } {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const p = Object.fromEntries(f.formatToParts(instant).map((x) => [x.type, x.value]));
  return {
    date: `${p['year']}-${p['month']}-${p['day']}`,
    minutes: Number(p['hour']) * 60 + Number(p['minute']),
  };
}

const hm = (s: string) => {
  const [h, m] = s.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

/** Whether a local time falls in quiet hours (the window may cross midnight). */
export function inQuietHours(minutes: number, start: string, end: string): boolean {
  const a = hm(start);
  const b = hm(end);
  return a <= b ? minutes >= a && minutes < b : minutes >= a || minutes < b;
}

/** Runs one signal through the pipeline. Order: freshness, rule status, liquidity, chase, event risk, toggles, snooze, dedupe and cooldown, quiet hours, cap. */
export function runPipeline(
  a: AlertInput,
  s: AlertSettings,
  state: PipelineState,
  now: Date,
): PipelineResult {
  const reasons: string[] = [];
  const local = localParts(now, s.timeZone);
  const key = dedupeKey(a, local.date);
  const done = (decision: Decision): PipelineResult => ({ decision, key, reasons });

  const maxAge = a.maxAgeSeconds ?? s.maxAgeSeconds[a.priority];
  if (a.worstAgeSeconds > maxAge) {
    reasons.push(
      `data too old: ${a.worstAgeSeconds} s against ${maxAge} s for ${a.maxAgeSeconds !== undefined ? 'end-of-day data' : a.priority}`,
    );
    return done('suppress');
  }
  reasons.push('data fresh');
  if (a.ruleStatus === 'shadow') {
    reasons.push('rule in shadow: logged, not delivered');
    return done('shadow');
  }
  reasons.push('rule live');
  const tradeKinds: AlertKind[] = ['setup', 'opportunity', 'rotation'];
  if (tradeKinds.includes(a.kind) && (a.dollarVolume ?? 0) < s.minDollarVolume) {
    reasons.push(
      `too illiquid: USD ${Math.round(a.dollarVolume ?? 0).toLocaleString('en-US')} traded`,
    );
    return done('suppress');
  }
  if (a.signalPrice && a.price && a.chaseLimit !== undefined) {
    const run = a.price / a.signalPrice - 1;
    if (run > a.chaseLimit) {
      reasons.push(
        `chase guard: ${toFixedHalfUp(run * 100, 1)}% past the signal price, limit ${toFixedHalfUp(a.chaseLimit * 100, 1)}%`,
      );
      return done('suppress');
    }
  }
  let priority = a.priority;
  if (a.context.nextEvent?.impact === 'high' && a.kind === 'setup') {
    const mins = (Date.parse(a.context.nextEvent.at) - now.getTime()) / 60_000;
    if (mins >= 0 && mins <= s.eventBlackoutMinutes) {
      reasons.push(
        `event risk: ${a.context.nextEvent.name} in ${Math.round(mins)} minutes; held to the digest`,
      );
      priority = 'digest';
    }
  }
  if (a.kind !== 'system' && !s.enabledKinds.includes(a.kind)) {
    reasons.push(`${a.kind} alerts are turned off; to the digest`);
    priority = 'digest';
  }
  const snooze = a.ticker ? s.snoozed[a.ticker] : undefined;
  if (snooze && Date.parse(snooze) > now.getTime() && a.priority !== 'critical') {
    reasons.push(`${a.ticker ?? ''} snoozed until ${snooze}`);
    return done('suppress');
  }
  const cooldownMs = s.cooldownMinutes * 60_000;
  const prefix = key.slice(0, key.lastIndexOf('|'));
  const hit = state.recent.find(
    (r) =>
      r.key === key ||
      (a.eventId === undefined &&
        r.key.startsWith(prefix) &&
        now.getTime() - Date.parse(r.at) < cooldownMs),
  );
  if (hit) {
    reasons.push(
      hit.key === key
        ? 'duplicate: already alerted today'
        : `cooldown: ${s.cooldownMinutes} minutes`,
    );
    return done('suppress');
  }
  if (priority === 'digest') return done('digest');
  if (priority !== 'critical' && inQuietHours(local.minutes, s.quietStart, s.quietEnd)) {
    reasons.push('quiet hours: to the digest');
    return done('digest');
  }
  if (priority !== 'critical' && state.pushesToday >= s.dailyPushCap) {
    reasons.push(`daily push cap of ${s.dailyPushCap} reached: to the digest`);
    return done('digest');
  }
  reasons.push(
    priority === 'critical' ? 'critical: pushed (bypasses quiet hours and the cap)' : 'pushed',
  );
  return done('push');
}

/** A risk row as text: loss rate with n and a 90% Wilson interval, "insufficient history" under 30, or "n/a". */
export function riskText(r: RiskRow): string {
  const label = r.horizon === 'scalp' ? 'scalp' : r.horizon === 'swing' ? 'swing' : 'long-term';
  if (r.n === null) return `${label} n/a`;
  if (r.n < MIN_CASES) return `${label}: insufficient history (n=${r.n})`;
  const w = wilson(r.losses, r.n);
  const p = (v: number) => toFixedHalfUp(v * 100, 1);
  return `${label} ${p(r.losses / r.n)}% loss rate (n=${r.n}, 90% CI ${w ? `${p(w.low)} to ${p(w.high)}%` : 'n/a'})`;
}

export interface CardSection {
  heading: string;
  lines: string[];
}

/** The card in the brief's order: header, trigger, plan, risk, context, checklist, bear case, sources and freshness. */
export function renderCard(a: AlertInput): CardSection[] {
  const out: CardSection[] = [];
  const kindLabel = a.kind.toUpperCase();
  out.push({
    heading: `[${kindLabel}, ${a.priority}]${a.ticker ? ` ${a.ticker}` : ''}`,
    lines: [
      a.headline,
      a.ruleStatus === 'shadow'
        ? `Shadow rule ${a.ruleId} v${a.ruleVersion} (not pushed).`
        : `Rule ${a.ruleId} v${a.ruleVersion}.`,
    ],
  });
  out.push({ heading: 'Trigger', lines: [a.trigger] });
  if (a.plan)
    out.push({
      heading: 'Plan',
      lines: [
        `Entry: ${a.plan.entry}`,
        ...(a.plan.stop !== undefined
          ? [
              `Stop ${toFixedHalfUp(a.plan.stop, 2)}; targets ${(a.plan.targets ?? []).map((x) => toFixedHalfUp(x, 2)).join(', ')}.`,
            ]
          : []),
        `Invalidation: ${a.plan.invalidation}`,
      ],
    });
  out.push({
    heading: 'Risk, this rule’s history',
    lines: [a.risk.map(riskText).join('; ') + '.'],
  });
  const c = a.context;
  const ctx: string[] = [];
  if (c.vix) ctx.push(`VIX ${c.vix.value} (${c.vix.asOf})`);
  if (c.fearGreed) ctx.push(`Fear and Greed composite ${c.fearGreed.value}`);
  if (c.regime) ctx.push(`regime: ${c.regime}`);
  if (c.nextEvent)
    ctx.push(`next: ${c.nextEvent.name}, ${c.nextEvent.at} (${c.nextEvent.impact} impact)`);
  out.push({
    heading: 'Context',
    lines: [ctx.length ? `${ctx.join('; ')}.` : 'No context available.'],
  });
  if (c.news && c.news.length > 0)
    out.push({
      heading: 'News',
      lines: c.news.slice(0, 3).map((n) => `Tier ${n.tier}: ${n.title}`),
    });
  if (a.checklist) {
    const k = a.checklist;
    const yes = (b: boolean) => (b ? 'yes' : 'no');
    out.push({
      heading: 'Checklist',
      lines: [
        `Clean setup ${yes(k.cleanSetup)}; not extended ${yes(k.notExtended)}; risk defined ${yes(k.riskDefined)}; profit plan ${yes(k.profitPlan)}; bear case read ${yes(k.bearCaseRead)}.`,
      ],
    });
  }
  out.push({ heading: 'Bear case', lines: [a.bearCase] });
  out.push({
    heading: 'Sources and freshness',
    lines: [
      ...a.sources.map((s) => `${s.label} (${s.asOf})`),
      `Oldest input ${a.worstAgeSeconds} s old${a.delayed ? ', delayed data' : ''}.`,
    ],
  });
  return out;
}

const clipTo = (s: string, n: number) =>
  s.length <= n ? s : `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}.`;

/** The push: title at most 60 characters (header), body at most 140 (one key line). */
export function pushText(a: AlertInput): { title: string; body: string } {
  return {
    title: clipTo(
      `[${a.kind.toUpperCase()}, ${a.priority}]${a.ticker ? ` ${a.ticker}` : ''}: ${a.headline}`,
      60,
    ),
    body: clipTo(a.trigger, 140),
  };
}

/** End-to-end latency by alert kind (source event to stored alert): n, median and 90th percentile, in ms. */
export function latencyByKind(
  rows: readonly { kind: string; latencyMs: number | null }[],
): { kind: string; n: number; median: number; p90: number }[] {
  const by = new Map<string, number[]>();
  for (const r of rows)
    if (r.latencyMs !== null && Number.isFinite(r.latencyMs))
      by.set(r.kind, [...(by.get(r.kind) ?? []), r.latencyMs]);
  return [...by.entries()]
    .map(([kind, xs]) => {
      const s = [...xs].sort((a, b) => a - b);
      return { kind, n: s.length, median: quantileSorted(s, 0.5), p90: quantileSorted(s, 0.9) };
    })
    .sort((a, b) => a.kind.localeCompare(b.kind));
}
