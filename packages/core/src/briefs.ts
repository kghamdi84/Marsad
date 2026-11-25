/**
 * Pre-market brief and close recap (ADR 0015, `brief-1`): built by templates from stored readings, so every number
 * in the text comes from the inputs, which are stored with the brief for replay. No model writes this text; an AI
 * narrative can be added later on top and is checked against the same inputs. Pure.
 */
import { toFixedHalfUp } from './ai/template.js';

export const BRIEF_VERSION = 'brief-1';

export type BriefKind = 'pre-market' | 'close-recap';

export interface BriefInputs {
  /** US Eastern date the brief is for. */
  date: string;
  regime: { date: string; label: string; recession: string } | null;
  fearGreed: { date: string; composite: number; label: string; available: number } | null;
  capitulation: { date: string; state: string } | null;
  vix: { date: string; value: number } | null;
  vix3m: { date: string; value: number } | null;
  breadth: { date: string; pctAbove50: number | null; pctAbove200: number | null } | null;
  /** Events on the brief's day (pre-market) or the next session (recap), in time order. */
  events: { date: string; timeEt: string; name: string; impact: string }[];
  /** Estimated earnings within the next 7 days. */
  earnings: { ticker: string; date: string }[];
  /** Watchlist day changes for the last session, any order. */
  watchlist: { ticker: string; date: string; change1d: number | null }[];
  /** The topic most above its usual level, if any (ratio at least 1.5 on at least 5 articles). */
  topic: { name: string; last7: number; ratio: number } | null;
  /** Sources that are stale or unavailable now. */
  staleSources: string[];
}

export interface BriefSection {
  heading: string;
  lines: string[];
}

export interface Brief {
  kind: BriefKind;
  date: string;
  version: string;
  /** At most 60 characters (push title). */
  title: string;
  /** At most 140 characters (push body). */
  pushBody: string;
  sections: BriefSection[];
}

const LABELS: Record<string, string> = {
  stress: 'Stress',
  bear: 'Bear',
  recovery: 'Recovery',
  'bull-calm': 'Bull, calm',
  'bull-correction': 'Bull, correction',
  'insufficient-data': 'Insufficient data',
  'extreme-fear': 'extreme fear',
  fear: 'fear',
  neutral: 'neutral',
  greed: 'greed',
  'extreme-greed': 'extreme greed',
};
const name = (k: string) => LABELS[k] ?? k;
const pct = (v: number, d = 1) => `${v > 0 ? '+' : ''}${toFixedHalfUp(v * 100, d)}%`;
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const weekday = (d: string) => WEEKDAY[new Date(`${d}T12:00:00Z`).getUTCDay()] ?? '';

/** Cuts text to `max` characters at a word boundary, ending with a full stop instead of a dangling word. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > 20 ? cut.slice(0, at) : cut).replace(/[,;:.\s]+$/, '')}.`;
}

function marketLines(x: BriefInputs): string[] {
  const out: string[] = [];
  if (x.regime)
    out.push(
      `Regime: ${name(x.regime.label)}; recession filter ${x.regime.recession} (as of ${x.regime.date}).`,
    );
  else out.push('Regime: not computed.');
  if (x.vix) {
    const ratio =
      x.vix3m && x.vix3m.date === x.vix.date && x.vix3m.value > 0
        ? `, VIX over VIX3M ${toFixedHalfUp(x.vix.value / x.vix3m.value, 2)}`
        : '';
    out.push(`VIX ${toFixedHalfUp(x.vix.value, 2)}${ratio} (${x.vix.date}).`);
  } else out.push('VIX: data unavailable.');
  if (x.fearGreed)
    out.push(
      `Fear and Greed composite ${Math.round(x.fearGreed.composite)}, ${name(x.fearGreed.label)} (${x.fearGreed.available} of 7 components, ${x.fearGreed.date}).`,
    );
  else out.push('Fear and Greed composite: not enough components yet.');
  if (x.breadth && x.breadth.pctAbove50 !== null)
    out.push(
      `Marsad universe above its 50-day average: ${toFixedHalfUp(x.breadth.pctAbove50, 1)}%${x.breadth.pctAbove200 === null ? '' : `; above the 200-day: ${toFixedHalfUp(x.breadth.pctAbove200, 1)}%`} (${x.breadth.date}).`,
    );
  if (x.capitulation?.state === 'on')
    out.push(
      `Capitulation watch is ON (${x.capitulation.date}); see the staged plan on the Regime page.`,
    );
  return out;
}

function eventLines(x: BriefInputs): string[] {
  if (x.events.length === 0) return ['No tracked releases or FOMC statement.'];
  return x.events.map(
    (e) => `${e.timeEt} ET ${e.name}${e.impact === 'high' ? ' (high impact)' : ''}.`,
  );
}

function moverLines(x: BriefInputs): string[] {
  const moved = x.watchlist
    .filter((w): w is { ticker: string; date: string; change1d: number } => w.change1d !== null)
    .sort((a, b) => Math.abs(b.change1d) - Math.abs(a.change1d) || a.ticker.localeCompare(b.ticker))
    .slice(0, 5);
  if (moved.length === 0) return ['No watchlist bars stored.'];
  return [`${moved.map((m) => `${m.ticker} ${pct(m.change1d)}`).join(', ')} (${moved[0]?.date}).`];
}

function closingLines(x: BriefInputs): string[] {
  const out: string[] = [];
  if (x.earnings.length > 0)
    out.push(
      `Estimated earnings this week: ${x.earnings.map((e) => `${e.ticker} around ${e.date}`).join(', ')} (estimates, not confirmed).`,
    );
  if (x.topic)
    out.push(
      `News: ${x.topic.name} coverage is ${toFixedHalfUp(x.topic.ratio, 1)} times its usual level (${x.topic.last7} articles in 7 days).`,
    );
  out.push(
    x.staleSources.length === 0
      ? 'System health: all sources current.'
      : `System health: stale or unavailable: ${x.staleSources.join(', ')}.`,
  );
  return out;
}

/** The pre-market brief: market state, today's events, the watchlist's last session, the week ahead and health. */
export function preMarketBrief(x: BriefInputs): Brief {
  const high = x.events.filter((e) => e.impact === 'high');
  const push = [
    x.regime ? `Regime ${name(x.regime.label)}.` : '',
    x.vix ? `VIX ${toFixedHalfUp(x.vix.value, 1)}.` : '',
    x.fearGreed ? `F&G ${Math.round(x.fearGreed.composite)}.` : '',
    high.length > 0
      ? `Today: ${high.map((e) => `${e.name} ${e.timeEt} ET`).join(', ')}.`
      : 'No high-impact data today.',
    x.staleSources.length > 0 ? `${x.staleSources.length} source(s) stale.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return {
    kind: 'pre-market',
    date: x.date,
    version: BRIEF_VERSION,
    title: clip(`Pre-market brief, ${weekday(x.date)} ${x.date}`, 60),
    pushBody: clip(push, 140),
    sections: [
      { heading: 'Market state', lines: marketLines(x) },
      { heading: 'Today (ET)', lines: eventLines(x) },
      { heading: 'Watchlist, last session', lines: moverLines(x) },
      { heading: 'Ahead and health', lines: closingLines(x) },
    ],
  };
}

/** The close recap: market state after the close, the watchlist's day, the next session's events and health. */
export function closeRecap(x: BriefInputs): Brief {
  const moved = moverLines(x)[0] ?? '';
  const push = [
    x.regime ? `Regime ${name(x.regime.label)}.` : '',
    x.vix ? `VIX ${toFixedHalfUp(x.vix.value, 1)}.` : '',
    moved.startsWith('No') ? '' : `Watchlist: ${moved}`,
  ]
    .filter(Boolean)
    .join(' ');
  return {
    kind: 'close-recap',
    date: x.date,
    version: BRIEF_VERSION,
    title: clip(`Close recap, ${weekday(x.date)} ${x.date}`, 60),
    pushBody: clip(push || 'Close recap ready.', 140),
    sections: [
      { heading: 'Market state', lines: marketLines(x) },
      { heading: 'Watchlist today', lines: moverLines(x) },
      { heading: 'Next session (ET)', lines: eventLines(x) },
      { heading: 'Ahead and health', lines: closingLines(x) },
    ],
  };
}
