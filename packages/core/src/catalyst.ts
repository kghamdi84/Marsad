/**
 * The catalyst watch (ADR 0030, `catalyst-1`): "if this happens, here is my plan". Khaled writes scenarios in
 * advance (entities, triggers, a plan with a chase guard, an expiry); code matches each day's filings, Form 4s,
 * news and halts against them. Critical priority needs a tier-1 source (filing, exchange notice) or two independent
 * tier-2 sources; otherwise the alert says it is unconfirmed. The plan is Khaled's, shown with the chase guard
 * applied to the real move. Pure.
 */
import type { AlertInput, Reading, RiskRow } from './alerts.js';
import { toFixedHalfUp } from './ai/template.js';
import { classifyPublisher, normalizePublisher, type SourceTier } from './news.js';

export const CATALYST_VERSION = 'catalyst-1';

export interface CatalystScenario {
  id: number;
  name: string;
  tickers: string[];
  /** People and keywords a news headline must mention to count (any one); empty means the ticker is enough. */
  keywords: string[];
  triggers: {
    /** 8-K item numbers, for example "5.02". */
    eightKItems: string[];
    /** Form 4 transaction codes, for example "P". */
    form4Codes: string[];
    /** News counts only at this tier or better (1 is best); null ignores news. */
    newsMinTier: SourceTier | null;
    halts: boolean;
    /** Close-to-close move, as a fraction (0.08 is 8%), up or down; null ignores price. */
    movePct: number | null;
    /** Session volume over its 20-session average, required with the move; null ignores volume. */
    volumeRatio: number | null;
  };
  plan: {
    entry: string;
    /** No entry when the move from the prior close is beyond this fraction. */
    chaseGuardPct: number;
    invalidation: string;
    size: string;
  };
  /** Last ET date the scenario is active. */
  expiresOn: string;
}

export type CatalystEvent =
  | { kind: '8-K'; ticker: string; at: string; items: string[]; accession: string }
  | { kind: 'form4'; ticker: string; at: string; code: string; owner: string; accession: string }
  | { kind: 'news'; tickers: string[]; at: string; title: string; publisher: string; id: string }
  | { kind: 'halt'; ticker: string; at: string; reason: string };

export interface SessionMove {
  ticker: string;
  date: string;
  prevClose: number;
  close: number;
  /** Session volume over the 20-session average, or null with too little history. */
  volumeRatio: number | null;
}

export interface MatchSource {
  label: string;
  tier: SourceTier;
  at: string;
  /** Normalized publisher, so two stories from one wire count once. */
  publisher: string;
}

export interface CatalystMatch {
  scenario: CatalystScenario;
  ticker: string;
  /** What matched, in plain words. */
  triggers: string[];
  sources: MatchSource[];
  confirmed: boolean;
  move: SessionMove | null;
}

/** Tier 1, or two tier-2 sources from different publishers. */
export function isConfirmed(sources: readonly MatchSource[]): boolean {
  if (sources.some((s) => s.tier === 1)) return true;
  return new Set(sources.filter((s) => s.tier === 2).map((s) => s.publisher)).size >= 2;
}

const pct = (v: number) => `${v > 0 ? '+' : ''}${toFixedHalfUp(v * 100, 1)}%`;

/** The scenario's matches for one session: one per ticker with at least one trigger. */
export function matchScenario(
  s: CatalystScenario,
  events: readonly CatalystEvent[],
  moves: readonly SessionMove[],
  today: string,
): CatalystMatch[] {
  if (today > s.expiresOn) return [];
  const words = s.keywords.map((k) => k.toLowerCase()).filter(Boolean);
  const out: CatalystMatch[] = [];
  for (const ticker of s.tickers) {
    const triggers: string[] = [];
    const sources: MatchSource[] = [];
    for (const e of events) {
      if (e.kind === '8-K' && e.ticker === ticker) {
        const hit = e.items.filter((i) => s.triggers.eightKItems.includes(i));
        if (hit.length === 0) continue;
        triggers.push(`8-K item ${hit.join(', ')}`);
        sources.push({
          label: `8-K ${e.accession} on SEC EDGAR`,
          tier: 1,
          at: e.at,
          publisher: 'sec',
        });
      } else if (
        e.kind === 'form4' &&
        e.ticker === ticker &&
        s.triggers.form4Codes.includes(e.code)
      ) {
        triggers.push(`Form 4 code ${e.code} (${e.owner})`);
        sources.push({
          label: `Form 4 ${e.accession} on SEC EDGAR`,
          tier: 1,
          at: e.at,
          publisher: 'sec',
        });
      } else if (e.kind === 'halt' && e.ticker === ticker && s.triggers.halts) {
        triggers.push(`Trading halt: ${e.reason}`);
        sources.push({
          label: 'Nasdaq Trader halt notice',
          tier: 1,
          at: e.at,
          publisher: 'nasdaq',
        });
      } else if (
        e.kind === 'news' &&
        s.triggers.newsMinTier !== null &&
        e.tickers.includes(ticker)
      ) {
        const title = e.title.toLowerCase();
        if (words.length > 0 && !words.some((w) => title.includes(w))) continue;
        const tier = classifyPublisher(e.publisher).tier;
        if (tier > s.triggers.newsMinTier) continue;
        triggers.push(`News: ${e.title}`);
        sources.push({
          label: `${e.publisher} (tier ${tier})`,
          tier,
          at: e.at,
          publisher: normalizePublisher(e.publisher),
        });
      }
    }
    const move = moves.find((m) => m.ticker === ticker) ?? null;
    if (move && s.triggers.movePct !== null) {
      const change = move.close / move.prevClose - 1;
      const volOk =
        s.triggers.volumeRatio === null ||
        (move.volumeRatio !== null && move.volumeRatio >= s.triggers.volumeRatio);
      if (Math.abs(change) >= s.triggers.movePct && volOk)
        triggers.push(
          `Moved ${pct(change)} on ${move.date}${move.volumeRatio === null ? '' : ` at ${toFixedHalfUp(move.volumeRatio, 1)}x average volume`}`,
        );
    }
    if (triggers.length === 0) continue;
    out.push({ scenario: s, ticker, triggers, sources, confirmed: isConfirmed(sources), move });
  }
  return out;
}

/** The alert input for a match. `analogs` is how many comparable past events Marsad has stored for the ticker. */
export function catalystAlert(
  m: CatalystMatch,
  context: { vix?: Reading; regime?: string },
  analogs: { label: string; n: number },
  now: Date,
): AlertInput {
  const s = m.scenario;
  const change = m.move ? m.move.close / m.move.prevClose - 1 : null;
  const chased = change !== null && Math.abs(change) > s.plan.chaseGuardPct;
  const newest = [...m.sources.map((x) => x.at), ...(m.move ? [`${m.move.date}T21:00:00Z`] : [])]
    .map((t) => Date.parse(t))
    .filter((t) => Number.isFinite(t));
  const age = newest.length
    ? Math.max(0, Math.round((now.getTime() - Math.max(...newest)) / 1000))
    : 0;
  const risk: RiskRow[] = (['scalp', 'swing', 'long'] as const).map((horizon) => ({
    horizon,
    losses: 0,
    n: horizon === 'swing' ? analogs.n : null,
  }));
  return {
    kind: 'catalyst',
    priority: m.confirmed ? 'critical' : 'high',
    ticker: m.ticker,
    ruleId: `scenario-${s.id}`,
    ruleVersion: 1,
    // Scenarios run on end-of-day data until live feeds exist; they are recorded but not pushed.
    ruleStatus: 'shadow',
    eventId: `catalyst:${s.id}:${m.ticker}:${m.move?.date ?? now.toISOString().slice(0, 10)}`,
    headline: `${m.ticker}: scenario "${s.name}" matched${m.confirmed ? '' : ' (unconfirmed)'}`,
    trigger: `${m.triggers.join('; ')}. ${
      m.confirmed
        ? `Confirmed by: ${m.sources
            .filter((x) => x.tier <= 2)
            .map((x) => x.label)
            .join(', ')}.`
        : 'Unconfirmed: no tier-1 source and fewer than two independent tier-2 sources.'
    }`,
    // The chase guard is applied in the plan text, not as a pipeline gate: a chased catalyst is still shown, with
    // "no entry", as the brief's example does.
    ...(m.move ? { price: m.move.close } : {}),
    plan: {
      entry: chased
        ? `No entry: the ${pct(change as number)} move is beyond the ${toFixedHalfUp(s.plan.chaseGuardPct * 100, 1)}% chase guard. Planned entry otherwise: ${s.plan.entry}`
        : s.plan.entry,
      invalidation: `${s.plan.invalidation} Size: ${s.plan.size}`,
    },
    risk,
    context: { ...context, news: [] },
    bearCase: `Catalyst moves often retrace part of the first reaction, and the scenario was written before today's facts. ${analogs.n < 30 ? `Only ${analogs.n} comparable past ${analogs.label} stored: insufficient history for a rate.` : `${analogs.n} comparable past ${analogs.label} stored.`}`,
    sources: m.sources.map((x) => ({ id: x.publisher, label: x.label, asOf: x.at })),
    worstAgeSeconds: age,
    // End-of-day matching: the day's events are judged after the close, so up to a day old.
    maxAgeSeconds: 26 * 3600,
    delayed: true,
  };
}
