/**
 * The scorecard (ADR 0023, `scorecard-1`): every directional alert's outcome after 1, 5 and 20 sessions against
 * SPY, with maximum favorable and adverse excursion and whether its stop or first target was touched first; then
 * per-rule summaries (win rate with a 90% Wilson interval, mean return, mean excess return), live against shadow,
 * and calibration of a quality score. Summaries are computed only from stored outcomes, so every figure can be
 * recomputed from them. Pure.
 */
import { etDate } from './calendar.js';
import { MIN_CASES, wilson } from './stats.js';
import type { DailyBar } from './study.js';

export const SCORECARD_VERSION = 'scorecard-1';

/** Sessions after the alert. The brief's +1 hour needs intraday bars, which the current plan does not include. */
export const HORIZONS = [
  { key: '1d', sessions: 1 },
  { key: '5d', sessions: 5 },
  { key: '20d', sessions: 20 },
] as const;
export type HorizonKey = (typeof HORIZONS)[number]['key'];

/** Which way the alert pointed: exits are right when the price falls; setups when it rises. */
export type Direction = 'up' | 'down';

export function directionOf(kind: string): Direction | null {
  if (kind === 'exit') return 'down';
  if (['setup', 'opportunity', 'rotation', 'catalyst'].includes(kind)) return 'up';
  return null; // halts, regime and system alerts make no directional call
}

export interface ScoredAlert {
  id: string;
  createdAt: string;
  kind: string;
  ticker: string | null;
  ruleId: string;
  ruleStatus: 'shadow' | 'live';
  plan?: { stop: number; targets: number[] } | undefined;
  /** 0 to 100 when the rule produced one. */
  qualityScore?: number | undefined;
}

export interface Outcome {
  alertId: string;
  horizon: HorizonKey;
  status: 'done' | 'pending' | 'unavailable';
  /** Why the outcome is pending or unavailable. */
  note: string | null;
  /** Session whose close is the reference price. */
  refDate: string | null;
  endDate: string | null;
  /** Return in the alert's direction (a fall counts as positive for an exit alert). */
  ret: number | null;
  benchRet: number | null;
  /** ret minus SPY's return in the same direction over the same sessions. */
  excess: number | null;
  /** Best and worst move in the alert's direction within the window, from highs and lows. */
  mfe: number | null;
  mae: number | null;
  /** Which level was touched first; a bar touching both counts as the stop. Null without a plan. */
  hit: 'stop' | 'target' | 'neither' | null;
}

function etHour(instant: Date): number {
  const h = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(instant);
  return Number(h);
}

/** The newest session whose close had happened when the alert fired (16:00 ET). */
export function referenceIndex(bars: readonly DailyBar[], firedAt: Date): number {
  const day = etDate(firedAt);
  const afterClose = etHour(firedAt) >= 16;
  let idx = -1;
  for (let i = 0; i < bars.length; i++) {
    const d = (bars[i] as DailyBar).date;
    if (d < day || (d === day && afterClose)) idx = i;
    else break;
  }
  return idx;
}

const blank = (alertId: string, horizon: HorizonKey) => ({
  alertId,
  horizon,
  refDate: null,
  endDate: null,
  ret: null,
  benchRet: null,
  excess: null,
  mfe: null,
  mae: null,
  hit: null,
});

/** The outcomes of one alert at every horizon, from the ticker's and SPY's daily bars. */
export function alertOutcomes(
  a: ScoredAlert,
  bars: readonly DailyBar[],
  spy: readonly DailyBar[],
): Outcome[] {
  const dir = directionOf(a.kind);
  if (dir === null || a.ticker === null)
    return HORIZONS.map((h) => ({
      ...blank(a.id, h.key),
      status: 'unavailable' as const,
      note: 'not a directional alert',
    }));
  const ref = referenceIndex(bars, new Date(a.createdAt));
  if (ref < 0)
    return HORIZONS.map((h) => ({
      ...blank(a.id, h.key),
      status: 'unavailable' as const,
      note: 'no bar before the alert',
    }));
  const r0 = bars[ref] as DailyBar;
  const spyByDate = new Map(spy.map((b) => [b.date, b.close]));
  const sign = dir === 'up' ? 1 : -1;
  return HORIZONS.map((h) => {
    const end = bars[ref + h.sessions];
    if (!end)
      return {
        ...blank(a.id, h.key),
        refDate: r0.date,
        status: 'pending' as const,
        note: `${bars.length - 1 - ref} of ${h.sessions} sessions so far`,
      };
    const window = bars.slice(ref + 1, ref + h.sessions + 1);
    const s0 = spyByDate.get(r0.date);
    const s1 = spyByDate.get(end.date);
    const ret = sign * (end.close / r0.close - 1);
    const benchRet = s0 !== undefined && s1 !== undefined ? sign * (s1 / s0 - 1) : null;
    const hi = Math.max(...window.map((b) => b.high)) / r0.close - 1;
    const lo = Math.min(...window.map((b) => b.low)) / r0.close - 1;
    let hit: Outcome['hit'] = null;
    if (a.plan && dir === 'up') {
      hit = 'neither';
      const target = a.plan.targets[0];
      for (const b of window) {
        if (b.low <= a.plan.stop) {
          hit = 'stop';
          break;
        }
        if (target !== undefined && b.high >= target) {
          hit = 'target';
          break;
        }
      }
    }
    return {
      alertId: a.id,
      horizon: h.key,
      status: 'done' as const,
      note: benchRet === null ? 'no SPY bar for the window' : null,
      refDate: r0.date,
      endDate: end.date,
      ret,
      benchRet,
      excess: benchRet === null ? null : ret - benchRet,
      mfe: dir === 'up' ? hi : -lo,
      mae: dir === 'up' ? lo : -hi,
      hit,
    };
  });
}

export interface RuleSummary {
  ruleId: string;
  status: 'live' | 'shadow';
  horizon: HorizonKey;
  /** Finished outcomes. */
  n: number;
  wins: number;
  winRate: number | null;
  /** 90% Wilson interval of the win rate; null under 30 cases. */
  winCi: { low: number; high: number } | null;
  /** Mean directional return: the expectancy per alert, before costs. */
  meanRet: number | null;
  meanExcess: number | null;
  meanMfe: number | null;
  meanMae: number | null;
  stops: number;
  targets: number;
  insufficient: boolean;
}

const mean = (xs: readonly number[]) =>
  xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;

/** Per rule, rule status and horizon, from finished outcomes only. */
export function summarize(
  alerts: readonly ScoredAlert[],
  outcomes: readonly Outcome[],
): RuleSummary[] {
  const byId = new Map(alerts.map((a) => [a.id, a]));
  const groups = new Map<string, { a: ScoredAlert; o: Outcome }[]>();
  for (const o of outcomes) {
    const a = byId.get(o.alertId);
    if (!a || o.status !== 'done' || o.ret === null) continue;
    const k = `${a.ruleId}|${a.ruleStatus}|${o.horizon}`;
    const g = groups.get(k) ?? [];
    g.push({ a, o });
    groups.set(k, g);
  }
  return [...groups.entries()]
    .map(([k, g]) => {
      const [ruleId, status, horizon] = k.split('|') as [string, 'live' | 'shadow', HorizonKey];
      const n = g.length;
      const wins = g.filter((x) => (x.o.ret as number) > 0).length;
      const insufficient = n < MIN_CASES;
      const ex = g.map((x) => x.o.excess).filter((v): v is number => v !== null);
      return {
        ruleId,
        status,
        horizon,
        n,
        wins,
        winRate: n > 0 ? wins / n : null,
        winCi: insufficient ? null : wilson(wins, n),
        meanRet: mean(g.map((x) => x.o.ret as number)),
        meanExcess: mean(ex),
        meanMfe: mean(g.map((x) => x.o.mfe as number)),
        meanMae: mean(g.map((x) => x.o.mae as number)),
        stops: g.filter((x) => x.o.hit === 'stop').length,
        targets: g.filter((x) => x.o.hit === 'target').length,
        insufficient,
      };
    })
    .sort(
      (x, y) =>
        x.ruleId.localeCompare(y.ruleId) ||
        x.status.localeCompare(y.status) ||
        HORIZONS.findIndex((h) => h.key === x.horizon) -
          HORIZONS.findIndex((h) => h.key === y.horizon),
    );
}

export interface CalibrationBin {
  /** Score range, inclusive low, exclusive high (the last bin includes 100). */
  low: number;
  high: number;
  n: number;
  winRate: number | null;
  ci: { low: number; high: number } | null;
}

/**
 * Calibration of a 0-to-100 quality score at one horizon: the win rate in equal-width score bins. A calibrated
 * score has win rates that rise with the bins. Null when fewer than 30 finished alerts carry a score.
 */
export function calibration(
  alerts: readonly ScoredAlert[],
  outcomes: readonly Outcome[],
  horizon: HorizonKey,
  bins = 5,
): CalibrationBin[] | null {
  const byId = new Map(alerts.map((a) => [a.id, a]));
  const pts = outcomes.flatMap((o) => {
    const s = byId.get(o.alertId)?.qualityScore;
    return o.horizon === horizon && o.status === 'done' && o.ret !== null && s !== undefined
      ? [{ s, win: o.ret > 0 }]
      : [];
  });
  if (pts.length < MIN_CASES) return null;
  const width = 100 / bins;
  return Array.from({ length: bins }, (_, i) => {
    const low = i * width;
    const high = (i + 1) * width;
    const inBin = pts.filter((p) => p.s >= low && (p.s < high || (i === bins - 1 && p.s <= 100)));
    const wins = inBin.filter((p) => p.win).length;
    return {
      low,
      high,
      n: inBin.length,
      winRate: inBin.length ? wins / inBin.length : null,
      ci: inBin.length >= MIN_CASES ? wilson(wins, inBin.length) : null,
    };
  });
}
