/**
 * Feed health and job run records. Silence must never look like calm: when a feed that should be
 * speaking goes quiet during a session, rules that depend on it are paused and a system alert is
 * raised; when it returns, a recovery alert follows.
 */
import { sessionInfo, type MarketCalendar, type SessionState } from './calendar.js';
import { formatAge } from './provenance.js';

export interface SourcePolicy {
  source: string;
  label: string;
  /** Rule ids that must not fire while this source is stale. */
  dependentRules: readonly string[];
  /** Longest tolerated silence in seconds per session state. Null means the source is not expected to speak. */
  maxSilenceSec: Readonly<Record<SessionState, number | null>>;
  /** If true, a source that has never reported counts as stale when it is expected to speak. */
  required: boolean;
}

export type HealthState = 'ok' | 'stale' | 'not-expected' | 'never';

export interface SourceHealth {
  source: string;
  state: HealthState;
  silenceSec: number | null;
  session: SessionState;
  lastMessageAt: Date | null;
}

export function evaluateSourceHealth(
  policy: SourcePolicy,
  lastMessageAt: Date | null,
  now: Date,
  calendar: MarketCalendar,
): SourceHealth {
  const session = sessionInfo(now, calendar).state;
  const limit = policy.maxSilenceSec[session];
  const silenceSec = lastMessageAt ? (now.getTime() - lastMessageAt.getTime()) / 1000 : null;
  const base = { source: policy.source, silenceSec, session, lastMessageAt };
  if (limit === null) return { ...base, state: 'not-expected' };
  if (silenceSec === null) return { ...base, state: policy.required ? 'stale' : 'never' };
  return { ...base, state: silenceSec > limit ? 'stale' : 'ok' };
}

export interface SystemAlert {
  kind: 'system';
  priority: 'critical';
  event: 'stale' | 'recovered' | 'mismatch';
  source: string;
  /** Up to 90 characters, factual. */
  headline: string;
  trigger: string;
  pausedRules: readonly string[];
  lastGoodAt: string | null; // UTC ISO
  createdAt: string; // UTC ISO
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}.`;
}

/**
 * Compares the current health of each source with its previous state and returns alerts only for
 * transitions, so a feed that stays down raises one alert, not one per check.
 */
export function healthTransitions(
  policies: readonly SourcePolicy[],
  previous: Readonly<Record<string, HealthState>>,
  current: readonly SourceHealth[],
  now: Date,
): SystemAlert[] {
  const alerts: SystemAlert[] = [];
  for (const h of current) {
    const policy = policies.find((p) => p.source === h.source);
    if (!policy) continue;
    const before = previous[h.source] ?? 'ok';
    const lastGoodAt = h.lastMessageAt ? h.lastMessageAt.toISOString() : null;
    if (h.state === 'stale' && before !== 'stale') {
      const age =
        h.silenceSec === null ? 'no data received yet' : `silent for ${formatAge(h.silenceSec)}`;
      alerts.push({
        kind: 'system',
        priority: 'critical',
        event: 'stale',
        source: h.source,
        headline: truncate(`${policy.label} stale, ${age}, ${h.session} session`, 90),
        trigger: `${policy.label}: ${age} during the ${h.session} session.`,
        pausedRules: policy.dependentRules,
        lastGoodAt,
        createdAt: now.toISOString(),
      });
    } else if (h.state === 'ok' && before === 'stale') {
      alerts.push({
        kind: 'system',
        priority: 'critical',
        event: 'recovered',
        source: h.source,
        headline: truncate(
          `${policy.label} recovered, ${policy.dependentRules.length} rules resumed`,
          90,
        ),
        trigger: `${policy.label} is reporting again.`,
        pausedRules: policy.dependentRules,
        lastGoodAt,
        createdAt: now.toISOString(),
      });
    }
  }
  return alerts;
}

/** Rule ids that must be paused right now because a source they depend on is stale. */
export function pausedRules(
  policies: readonly SourcePolicy[],
  current: readonly SourceHealth[],
): string[] {
  const stale = new Set(current.filter((h) => h.state === 'stale').map((h) => h.source));
  const out = new Set<string>();
  for (const p of policies) if (stale.has(p.source)) for (const r of p.dependentRules) out.add(r);
  return [...out].sort();
}

/** Starting policies for the sources Marsad reads. Tunable; limits are seconds of silence. */
export const DEFAULT_SOURCE_POLICIES: readonly SourcePolicy[] = [
  {
    source: 'massive',
    label: 'Massive (market data)',
    dependentRules: ['group:prices'],
    maxSilenceSec: { 'pre-market': 600, regular: 120, 'after-hours': 600, closed: null },
    required: false,
  },
  {
    source: 'nasdaq_halts',
    label: 'Nasdaq trade halts',
    dependentRules: ['group:halts'],
    maxSilenceSec: { 'pre-market': 300, regular: 120, 'after-hours': 300, closed: null },
    required: false,
  },
  {
    source: 'sec_edgar',
    label: 'SEC EDGAR',
    dependentRules: ['group:filings'],
    maxSilenceSec: { 'pre-market': 900, regular: 600, 'after-hours': 900, closed: null },
    required: false,
  },
  {
    source: 'fred',
    label: 'FRED (St. Louis Fed)',
    dependentRules: ['group:macro'],
    maxSilenceSec: { 'pre-market': 259200, regular: 259200, 'after-hours': 259200, closed: 259200 },
    required: false,
  },
  {
    source: 'gpr',
    label: 'Geopolitical Risk Index',
    dependentRules: ['group:geopolitics'],
    maxSilenceSec: { 'pre-market': 345600, regular: 345600, 'after-hours': 345600, closed: 345600 },
    required: false,
  },
];

export interface SourceStatusView {
  state: HealthState | 'calendar-missing';
  /** Text for the UI. State is always words, never color alone. */
  label: string;
  silenceSec: number | null;
  limitSec: number | null;
  session: SessionState;
}

/**
 * What the status page shows for a source. If the policy depends on the session and the market
 * calendar has not been loaded, it says so instead of guessing.
 */
export function describeSourceHealth(
  policy: SourcePolicy,
  lastMessageAt: Date | null,
  now: Date,
  calendar: MarketCalendar,
): SourceStatusView {
  const info = sessionInfo(now, calendar);
  const limits = Object.values(policy.maxSilenceSec);
  const sessionDependent = new Set(limits).size > 1;
  if (sessionDependent && !info.calendarCovered) {
    return {
      state: 'calendar-missing',
      label: 'Calendar not loaded, cannot judge',
      silenceSec: null,
      limitSec: null,
      session: info.state,
    };
  }
  const h = evaluateSourceHealth(policy, lastMessageAt, now, calendar);
  const limitSec = policy.maxSilenceSec[h.session];
  const limit = limitSec === null ? '' : ` (limit ${formatAge(limitSec)})`;
  const silence = h.silenceSec === null ? '' : formatAge(h.silenceSec);
  const labels: Record<HealthState, string> = {
    ok: `OK, last message ${silence} ago${limit}`,
    stale:
      h.silenceSec === null ? 'STALE, no data received yet' : `STALE, silent ${silence}${limit}`,
    'not-expected': `Quiet is normal (${h.session})`,
    never: 'No data received yet',
  };
  return {
    state: h.state,
    label: labels[h.state],
    silenceSec: h.silenceSec,
    limitSec,
    session: h.session,
  };
}

export type JobStatus = 'ok' | 'error' | 'skipped';

/** A row for `public.job_runs`. */
export interface JobRunRecord {
  job: string;
  started_at: string;
  finished_at: string;
  status: JobStatus;
  rows_written: number | null;
  latency_ms: number;
  error: string | null;
  details: Record<string, unknown>;
}

export interface JobOutcome {
  rows?: number;
  skipped?: string; // reason, when the job chose to do nothing
  details?: Record<string, unknown>;
}

/**
 * Runs a job and always returns a run record, including when it throws. A job can never fail without
 * leaving a record, so there are no silent failures.
 */
export async function runJob(
  job: string,
  fn: () => Promise<JobOutcome>,
  now: () => number,
): Promise<JobRunRecord> {
  const started = now();
  const record = (status: JobStatus, o: JobOutcome, error: string | null): JobRunRecord => {
    const finished = now();
    return {
      job,
      started_at: new Date(started).toISOString(),
      finished_at: new Date(finished).toISOString(),
      status,
      rows_written: o.rows ?? null,
      latency_ms: finished - started,
      error,
      details: { ...(o.details ?? {}), ...(o.skipped ? { skipped: o.skipped } : {}) },
    };
  };
  try {
    const o = await fn();
    return record(o.skipped ? 'skipped' : 'ok', o, null);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return record('error', {}, message.slice(0, 500));
  }
}
