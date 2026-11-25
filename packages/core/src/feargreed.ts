/**
 * Fear and Greed composite (ADR 0011, `fear-greed-1`): seven components after CNN's published method, each scored
 * 0 to 100 by its percentile over its own last 504 values, averaged over the components available that day.
 * Pure: the caller supplies every series.
 */
import type { Obs } from './regime.js';
import { seriesDifference } from './regime.js';

export const FEAR_GREED_VERSION = 'fear-greed-1';

export const FEAR_GREED_RULES = Object.freeze({
  window: 504,
  minWindow: 252,
  minComponents: 4,
  momentumSessions: 125,
  volatilitySessions: 50,
  safeHavenSessions: 20,
  putCallSessions: 5,
  minMembers: 500,
});

export type ComponentKey =
  'momentum' | 'strength' | 'breadth' | 'putCall' | 'junk' | 'volatility' | 'safeHaven';

/** Display order, as CNN lists them. */
export const COMPONENT_KEYS: readonly ComponentKey[] = [
  'momentum',
  'strength',
  'breadth',
  'putCall',
  'junk',
  'volatility',
  'safeHaven',
];

/** Components where a high raw value means fear; their score is 100 minus the percentile. */
const FEAR_HIGH: ReadonlySet<ComponentKey> = new Set(['putCall', 'junk', 'volatility']);

export const COMPONENT_SOURCES: Readonly<Record<ComponentKey, string>> = Object.freeze({
  momentum: 'FRED SP500',
  strength: 'Marsad universe breadth',
  breadth: 'Marsad universe breadth',
  putCall: 'none on the current plans',
  junk: 'FRED BAMLH0A0HYM2 minus BAMLC0A0CM',
  volatility: 'FRED VIXCLS',
  safeHaven: 'Massive daily bars SPY and IEF',
});

export type FearGreedLabel = 'extreme-fear' | 'fear' | 'neutral' | 'greed' | 'extreme-greed';

/** CNN's bands, on the composite rounded to a whole number. */
export function fearGreedLabel(composite: number): FearGreedLabel {
  const r = Math.round(composite);
  if (r <= 24) return 'extreme-fear';
  if (r <= 44) return 'fear';
  if (r <= 55) return 'neutral';
  if (r <= 75) return 'greed';
  return 'extreme-greed';
}

/** The breadth fields the composite reads (one row per breadth session). */
export interface BreadthInput {
  date: string;
  newHighs: number;
  newLows: number;
  n252: number;
  mcclellanSummation: number | null;
}

export interface FearGreedInputs {
  sp500: readonly Obs[];
  vix: readonly Obs[];
  highYield: readonly Obs[];
  investmentGrade: readonly Obs[];
  breadth: readonly BreadthInput[];
  spy: readonly Obs[];
  ief: readonly Obs[];
  /** Daily put/call ratio; absent on the current plans. */
  putCall?: readonly Obs[];
}

export type ComponentReason = 'no-source' | 'no-data' | 'short-history';

export interface ComponentReading {
  key: ComponentKey;
  /** The day's raw value; null when the component has none that day. */
  value: number | null;
  /** 0 to 100 (high is greed); null when not counted. */
  score: number | null;
  /** How many values the percentile rests on. */
  window: number;
  reason: ComponentReason | null;
}

export interface FearGreedDay {
  date: string;
  version: string;
  composite: number | null;
  label: FearGreedLabel | null;
  available: number;
  components: ComponentReading[];
}

/** `value / average of the last n values (including it) - 1`, from the n-th value on. */
export function overAverage(series: readonly Obs[], n: number): Obs[] {
  const out: Obs[] = [];
  let sum = 0;
  for (let i = 0; i < series.length; i++) {
    sum += (series[i] as Obs).value;
    if (i >= n) sum -= (series[i - n] as Obs).value;
    if (i >= n - 1) {
      const o = series[i] as Obs;
      out.push({ date: o.date, value: o.value / (sum / n) - 1 });
    }
  }
  return out;
}

/** The trailing n-value average, from the n-th value on. */
export function movingAverage(series: readonly Obs[], n: number): Obs[] {
  const out: Obs[] = [];
  let sum = 0;
  for (let i = 0; i < series.length; i++) {
    sum += (series[i] as Obs).value;
    if (i >= n) sum -= (series[i - n] as Obs).value;
    if (i >= n - 1) out.push({ date: (series[i] as Obs).date, value: sum / n });
  }
  return out;
}

/** 20-session return of `a` minus that of `b`, on the dates both have, counted in shared sessions. */
export function relativeReturn(a: readonly Obs[], b: readonly Obs[], n: number): Obs[] {
  const other = new Map(b.map((o) => [o.date, o.value]));
  const both = a.flatMap((o) => {
    const v = other.get(o.date);
    return v === undefined ? [] : [{ date: o.date, a: o.value, b: v }];
  });
  const out: Obs[] = [];
  for (let i = n; i < both.length; i++) {
    const now = both[i] as { date: string; a: number; b: number };
    const then = both[i - n] as { date: string; a: number; b: number };
    out.push({ date: now.date, value: now.a / then.a - 1 - (now.b / then.b - 1) });
  }
  return out;
}

/** Mid-rank percentile of `values[i]` among `values[i - window + 1 .. i]`, in 0 to 100. */
export function trailingPercentile(values: readonly number[], i: number, window: number): number {
  const v = values[i] as number;
  const start = Math.max(0, i - window + 1);
  let below = 0;
  let equal = 0;
  for (let j = start; j <= i; j++) {
    const x = values[j] as number;
    if (x < v) below += 1;
    else if (x === v) equal += 1;
  }
  return (100 * (below + equal / 2)) / (i - start + 1);
}

/** The raw daily series of each component. */
export function componentSeries(inputs: FearGreedInputs): Record<ComponentKey, Obs[]> {
  const r = FEAR_GREED_RULES;
  return {
    momentum: overAverage(inputs.sp500, r.momentumSessions),
    strength: inputs.breadth
      .filter((d) => d.n252 >= r.minMembers)
      .map((d) => ({ date: d.date, value: (d.newHighs - d.newLows) / d.n252 })),
    breadth: inputs.breadth.flatMap((d) =>
      d.mcclellanSummation === null ? [] : [{ date: d.date, value: d.mcclellanSummation }],
    ),
    putCall: inputs.putCall ? movingAverage(inputs.putCall, r.putCallSessions) : [],
    junk: seriesDifference(inputs.highYield, inputs.investmentGrade),
    volatility: overAverage(inputs.vix, r.volatilitySessions),
    safeHaven: relativeReturn(inputs.spy, inputs.ief, r.safeHavenSessions),
  };
}

interface Scored {
  value: number;
  score: number | null;
  window: number;
}

function scoreSeries(key: ComponentKey, series: readonly Obs[]): Map<string, Scored> {
  const r = FEAR_GREED_RULES;
  const values = series.map((o) => o.value);
  const out = new Map<string, Scored>();
  series.forEach((o, i) => {
    const window = Math.min(i + 1, r.window);
    if (window < r.minWindow) {
      out.set(o.date, { value: o.value, score: null, window });
      return;
    }
    const p = trailingPercentile(values, i, r.window);
    out.set(o.date, { value: o.value, score: FEAR_HIGH.has(key) ? 100 - p : p, window });
  });
  return out;
}

/**
 * The composite for every day on which at least one component has a value, oldest first. Each component counts
 * only with a value dated that day (nothing is carried forward).
 */
export function fearGreedHistory(inputs: FearGreedInputs): FearGreedDay[] {
  const raw = componentSeries(inputs);
  const scored = new Map(COMPONENT_KEYS.map((k) => [k, scoreSeries(k, raw[k])]));
  const dates = [...new Set(COMPONENT_KEYS.flatMap((k) => raw[k].map((o) => o.date)))].sort();
  return dates.map((date) => {
    const components = COMPONENT_KEYS.map((key): ComponentReading => {
      if (key === 'putCall' && !inputs.putCall)
        return { key, value: null, score: null, window: 0, reason: 'no-source' };
      const s = scored.get(key)?.get(date);
      if (!s) return { key, value: null, score: null, window: 0, reason: 'no-data' };
      return {
        key,
        value: s.value,
        score: s.score,
        window: s.window,
        reason: s.score === null ? 'short-history' : null,
      };
    });
    const scores = components.flatMap((c) => (c.score === null ? [] : [c.score]));
    const composite =
      scores.length >= FEAR_GREED_RULES.minComponents
        ? scores.reduce((a, b) => a + b, 0) / scores.length
        : null;
    return {
      date,
      version: FEAR_GREED_VERSION,
      composite,
      label: composite === null ? null : fearGreedLabel(composite),
      available: scores.length,
      components,
    };
  });
}
