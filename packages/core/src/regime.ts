/**
 * Market regime: the recession filter, the regime label and the event-study statistics, as documented in
 * ADR 0009 (docs/adr/0009-regime-methodology.md). Pure functions over stored daily, weekly and monthly series, so
 * any label can be recomputed from what is stored. Every value is used only from the day it was published.
 */
import { sma } from './indicators.js';

export const REGIME_RULE_VERSION = 'regime-1';
export const RECESSION_RULE_VERSION = 'recession-1';
export const EVENT_STUDY_VERSION = 'event-study-1';

/** One observation of a series. Dates are ISO (YYYY-MM-DD); series are kept in ascending date order. */
export interface Obs {
  date: string;
  value: number;
}

const DAY = 86_400_000;
const toDay = (d: string): number => Date.parse(`${d}T00:00:00Z`) / DAY;
const fromDay = (n: number): string => new Date(n * DAY).toISOString().slice(0, 10);
const addDays = (d: string, n: number): string => fromDay(toDay(d) + n);

/**
 * The first day a value can be used. Market closes are known at the close; weekly claims (week ending Saturday)
 * come out the following Thursday; NFCI (week ending Friday) the following Wednesday; the Sahm rule for a month
 * with the jobs report early the next month, taken from the 10th so it never runs ahead of the release.
 */
export function publishedOn(seriesId: string, obsDate: string): string {
  switch (seriesId) {
    case 'ICSA':
    case 'NFCI':
      return addDays(obsDate, 5);
    case 'SAHMREALTIME': {
      const [y, m] = obsDate.split('-').map(Number) as [number, number];
      const next = new Date(Date.UTC(y, m, 10)); // month index m is the next month (0-based)
      return next.toISOString().slice(0, 10);
    }
    default:
      return obsDate;
  }
}

/** Observations of a series that had been published on `asOf`, in date order. */
export function publishedBy(seriesId: string, series: readonly Obs[], asOf: string): Obs[] {
  return series.filter((o) => publishedOn(seriesId, o.date) <= asOf);
}

/** Largest gap, in calendar days, between the newest published value and `asOf` before a series counts as stale. */
const MAX_AGE_DAYS: Readonly<Record<string, number>> = {
  T10Y3M: 7,
  BAMLH0A0HYM2: 7,
  ICSA: 21,
  NFCI: 21,
  SAHMREALTIME: 75,
};

// ---------------------------------------------------------------------------------------------------------------
// Recession filter (recession-1)

export type SignalState = 'triggered' | 'clear' | 'unavailable';
export type SignalId = 'sahm' | 'curve' | 'credit' | 'claims' | 'nfci';

export interface RecessionSignal {
  id: SignalId;
  state: SignalState;
  /** The headline number of the signal (for example the Sahm rule value), null when unavailable. */
  value: number | null;
  /** The date of the observation used. */
  asOf: string | null;
  /** The FRED series behind it. */
  source: string;
  /** Supporting numbers, for the page and the stored snapshot. */
  detail: Record<string, number | null>;
}

export type RecessionLevel = 'low' | 'elevated' | 'high' | 'unavailable';

export interface RecessionFilter {
  ruleVersion: string;
  asOf: string;
  level: RecessionLevel;
  available: number;
  triggered: number;
  signals: RecessionSignal[];
}

export const RECESSION_THRESHOLDS = Object.freeze({
  sahm: 0.5,
  curveLookbackSessions: 378,
  curveInvertedSessions: 20,
  hySpreadLevel: 6.0,
  hySpreadChange: 1.5,
  hyChangeSessions: 63,
  claimsRise: 1.2,
  claimsWeeks: 52,
  nfci: 0,
});

export type MacroSeries = Partial<Record<string, readonly Obs[]>>;

function fresh(seriesId: string, obs: Obs | undefined, asOf: string): obs is Obs {
  if (!obs) return false;
  return toDay(asOf) - toDay(obs.date) <= (MAX_AGE_DAYS[seriesId] ?? 7);
}

function unavailable(id: SignalId, source: string): RecessionSignal {
  return { id, state: 'unavailable', value: null, asOf: null, source, detail: {} };
}

function sahmSignal(series: MacroSeries, asOf: string): RecessionSignal {
  const obs = publishedBy('SAHMREALTIME', series['SAHMREALTIME'] ?? [], asOf).at(-1);
  if (!fresh('SAHMREALTIME', obs, asOf)) return unavailable('sahm', 'SAHMREALTIME');
  return {
    id: 'sahm',
    state: obs.value >= RECESSION_THRESHOLDS.sahm ? 'triggered' : 'clear',
    value: obs.value,
    asOf: obs.date,
    source: 'SAHMREALTIME',
    detail: { threshold: RECESSION_THRESHOLDS.sahm },
  };
}

function curveSignal(series: MacroSeries, asOf: string): RecessionSignal {
  const obs = publishedBy('T10Y3M', series['T10Y3M'] ?? [], asOf);
  const last = obs.at(-1);
  if (!fresh('T10Y3M', last, asOf)) return unavailable('curve', 'T10Y3M');
  const window = obs.slice(-RECESSION_THRESHOLDS.curveLookbackSessions);
  const inverted = window.filter((o) => o.value < 0).length;
  const triggered = last.value < 0 || inverted >= RECESSION_THRESHOLDS.curveInvertedSessions;
  return {
    id: 'curve',
    state: triggered ? 'triggered' : 'clear',
    value: last.value,
    asOf: last.date,
    source: 'T10Y3M',
    detail: { invertedSessions: inverted, lookbackSessions: window.length },
  };
}

function creditSignal(series: MacroSeries, asOf: string): RecessionSignal {
  const obs = publishedBy('BAMLH0A0HYM2', series['BAMLH0A0HYM2'] ?? [], asOf);
  const last = obs.at(-1);
  if (!fresh('BAMLH0A0HYM2', last, asOf)) return unavailable('credit', 'BAMLH0A0HYM2');
  const earlier = obs[obs.length - 1 - RECESSION_THRESHOLDS.hyChangeSessions];
  const change = earlier ? last.value - earlier.value : null;
  const triggered =
    last.value >= RECESSION_THRESHOLDS.hySpreadLevel ||
    (change !== null && change >= RECESSION_THRESHOLDS.hySpreadChange);
  return {
    id: 'credit',
    state: triggered ? 'triggered' : 'clear',
    value: last.value,
    asOf: last.date,
    source: 'BAMLH0A0HYM2',
    detail: { change63: change },
  };
}

function claimsSignal(series: MacroSeries, asOf: string): RecessionSignal {
  const obs = publishedBy('ICSA', series['ICSA'] ?? [], asOf);
  const last = obs.at(-1);
  const weeks = RECESSION_THRESHOLDS.claimsWeeks;
  if (!fresh('ICSA', last, asOf) || obs.length < weeks + 4) return unavailable('claims', 'ICSA');
  const avg4 = (end: number) =>
    (obs.slice(end - 3, end + 1).reduce((s, o) => s + o.value, 0) as number) / 4;
  const n = obs.length - 1;
  const current = avg4(n);
  let low = Infinity;
  for (let i = n - weeks; i < n; i++) if (i >= 3) low = Math.min(low, avg4(i));
  const ratio = current / low;
  return {
    id: 'claims',
    state: ratio >= RECESSION_THRESHOLDS.claimsRise ? 'triggered' : 'clear',
    value: current,
    asOf: last.date,
    source: 'ICSA',
    detail: { low52w: low, ratio },
  };
}

function nfciSignal(series: MacroSeries, asOf: string): RecessionSignal {
  const obs = publishedBy('NFCI', series['NFCI'] ?? [], asOf).at(-1);
  if (!fresh('NFCI', obs, asOf)) return unavailable('nfci', 'NFCI');
  return {
    id: 'nfci',
    state: obs.value > RECESSION_THRESHOLDS.nfci ? 'triggered' : 'clear',
    value: obs.value,
    asOf: obs.date,
    source: 'NFCI',
    detail: {},
  };
}

/** The recession filter as it stood on `asOf`, from what had been published by then. */
export function recessionFilter(series: MacroSeries, asOf: string): RecessionFilter {
  const signals = [
    sahmSignal(series, asOf),
    curveSignal(series, asOf),
    creditSignal(series, asOf),
    claimsSignal(series, asOf),
    nfciSignal(series, asOf),
  ];
  const available = signals.filter((s) => s.state !== 'unavailable').length;
  const triggered = signals.filter((s) => s.state === 'triggered').length;
  const sahm = signals[0]?.state === 'triggered';
  const level: RecessionLevel =
    available < 3
      ? 'unavailable'
      : sahm || triggered >= 3
        ? 'high'
        : triggered >= 1
          ? 'elevated'
          : 'low';
  return { ruleVersion: RECESSION_RULE_VERSION, asOf, level, available, triggered, signals };
}

// ---------------------------------------------------------------------------------------------------------------
// Regime label (regime-1)

export type RegimeLabel =
  'stress' | 'bear' | 'recovery' | 'bull-calm' | 'bull-correction' | 'insufficient-data';

export const REGIME_THRESHOLDS = Object.freeze({
  stressVix: 30,
  calmVix: 20,
  calmDrawdown: -0.05,
  slopeSessions: 20,
  highSessions: 252,
  recoveryLookback: 63,
});

export interface RegimeInputs {
  date: string;
  sp500: number;
  sma50: number | null;
  sma200: number | null;
  /** The 200-session average 20 sessions earlier. */
  sma200Prior: number | null;
  /** Close over the highest close of the last 252 sessions, minus 1 (0 at a new high). */
  drawdown: number | null;
  vix: number | null;
  vix3m: number | null;
}

/** Which rule decided. The page turns the code into words. */
export type RegimeReason =
  | 'insufficient'
  | 'vix-high'
  | 'backwardation'
  | 'below-falling-200'
  | 'recovering'
  | 'calm'
  | 'pullback';

export interface RegimeDay {
  date: string;
  ruleVersion: string;
  label: RegimeLabel;
  reason: RegimeReason;
  inputs: RegimeInputs;
}

/** The label for one day from its inputs and whether a stress or bear day occurred in the previous 63 sessions. */
export function classifyRegime(
  x: RegimeInputs,
  recentStressOrBear: boolean,
): { label: RegimeLabel; reason: RegimeReason } {
  const T = REGIME_THRESHOLDS;
  if (
    x.vix === null ||
    x.sma50 === null ||
    x.sma200 === null ||
    x.sma200Prior === null ||
    x.drawdown === null
  )
    return { label: 'insufficient-data', reason: 'insufficient' };
  if (x.vix >= T.stressVix) return { label: 'stress', reason: 'vix-high' };
  if (x.vix3m !== null && x.vix >= x.vix3m && x.sp500 < x.sma50)
    return { label: 'stress', reason: 'backwardation' };
  if (x.sp500 < x.sma200 && x.sma200 < x.sma200Prior)
    return { label: 'bear', reason: 'below-falling-200' };
  if (recentStressOrBear && x.sp500 > x.sma50 && x.drawdown <= T.calmDrawdown)
    return { label: 'recovery', reason: 'recovering' };
  if (x.sp500 > x.sma200 && x.sp500 > x.sma50 && x.drawdown > T.calmDrawdown && x.vix < T.calmVix)
    return { label: 'bull-calm', reason: 'calm' };
  return { label: 'bull-correction', reason: 'pullback' };
}

/**
 * The label for every S&P 500 session, oldest first. `vix` and `vix3m` are matched by date; a session without a
 * VIX value is "insufficient data" rather than guessed.
 */
export function regimeHistory(
  sp500: readonly Obs[],
  vix: readonly Obs[],
  vix3m: readonly Obs[],
): RegimeDay[] {
  const T = REGIME_THRESHOLDS;
  const closes = sp500.map((o) => o.value);
  const s50 = sma(closes, 50);
  const s200 = sma(closes, 200);
  const vixBy = new Map(vix.map((o) => [o.date, o.value]));
  const vix3mBy = new Map(vix3m.map((o) => [o.date, o.value]));
  const out: RegimeDay[] = [];
  for (let i = 0; i < sp500.length; i++) {
    const day = sp500[i] as Obs;
    const enough = i >= T.highSessions - 1;
    let high = -Infinity;
    if (enough)
      for (let k = i - T.highSessions + 1; k <= i; k++) high = Math.max(high, closes[k] as number);
    const inputs: RegimeInputs = {
      date: day.date,
      sp500: day.value,
      sma50: enough ? (s50[i] ?? null) : null,
      sma200: enough ? (s200[i] ?? null) : null,
      sma200Prior: enough ? (s200[i - T.slopeSessions] ?? null) : null,
      drawdown: enough ? day.value / high - 1 : null,
      vix: vixBy.get(day.date) ?? null,
      vix3m: vix3mBy.get(day.date) ?? null,
    };
    const recent = out
      .slice(Math.max(0, out.length - T.recoveryLookback))
      .some((d) => d.label === 'stress' || d.label === 'bear');
    const { label, reason } = classifyRegime(inputs, recent);
    out.push({ date: day.date, ruleVersion: REGIME_RULE_VERSION, label, reason, inputs });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Event studies (event-study-1)

/** Quantile by linear interpolation between order statistics (NumPy's default). `sorted` must be ascending. */
export function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) throw new RangeError('quantile of an empty list');
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] as number;
  const b = sorted[hi] as number;
  return a + (pos - lo) * (b - a);
}

export const MIN_EPISODES = 30;

export interface ForwardStats {
  horizon: number;
  n: number;
  /** False below 30 episodes: the page shows "insufficient history" and not the numbers. */
  sufficient: boolean;
  median: number | null;
  q1: number | null;
  q3: number | null;
  min: number | null;
  max: number | null;
}

function stats(horizon: number, returns: number[]): ForwardStats {
  const s = [...returns].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0)
    return {
      horizon,
      n,
      sufficient: false,
      median: null,
      q1: null,
      q3: null,
      min: null,
      max: null,
    };
  return {
    horizon,
    n,
    sufficient: n >= MIN_EPISODES,
    median: quantile(s, 0.5),
    q1: quantile(s, 0.25),
    q3: quantile(s, 0.75),
    min: s[0] as number,
    max: s[n - 1] as number,
  };
}

export interface EventStudy {
  version: string;
  /** The first day of each episode. */
  episodes: string[];
  byHorizon: ForwardStats[];
}

/**
 * Forward returns after each episode of `condition`. An episode starts on a day the condition holds after a day it
 * did not, and not within `cooldown` sessions of the previous start, so windows of that length do not overlap.
 * A horizon that runs past the last close is left out of that horizon's count.
 */
export function eventStudy(
  closes: readonly Obs[],
  condition: readonly boolean[],
  horizons: readonly number[] = [21, 63, 126],
  cooldown = 63,
): EventStudy {
  if (condition.length !== closes.length) throw new RangeError('one condition value per close');
  const starts: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    const on = condition[i] === true;
    const wasOn = i > 0 && condition[i - 1] === true;
    const last = starts.at(-1);
    if (on && !wasOn && (last === undefined || i - last >= cooldown)) starts.push(i);
  }
  return {
    version: EVENT_STUDY_VERSION,
    episodes: starts.map((i) => (closes[i] as Obs).date),
    byHorizon: horizons.map((h) =>
      stats(
        h,
        starts
          .filter((i) => i + h < closes.length)
          .map((i) => (closes[i + h] as Obs).value / (closes[i] as Obs).value - 1),
      ),
    ),
  };
}

/** The benchmark: forward returns over non-overlapping windows starting every `horizon` sessions. */
export function baselineStudy(
  closes: readonly Obs[],
  horizons: readonly number[] = [21, 63, 126],
): ForwardStats[] {
  return horizons.map((h) => {
    const r: number[] = [];
    for (let i = 0; i + h < closes.length; i += h)
      r.push((closes[i + h] as Obs).value / (closes[i] as Obs).value - 1);
    return stats(h, r);
  });
}
