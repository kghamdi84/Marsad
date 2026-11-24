import { describe, expect, it } from 'vitest';
import upcoming from '../../../fixtures/massive/market-status-upcoming.json';
import { buildCalendar, type UpcomingRow } from './calendar.js';
import {
  DEFAULT_SOURCE_POLICIES,
  describeSourceHealth,
  evaluateSourceHealth,
  healthTransitions,
  pausedRules,
  runJob,
  type HealthState,
  type SourcePolicy,
} from './health.js';

const cal = buildCalendar(upcoming.data as UpcomingRow[], 'NYSE');
const D = (iso: string) => new Date(iso);

const options: SourcePolicy = {
  source: 'massive_options',
  label: 'Options data',
  dependentRules: [
    'opt-iv-cheap-call',
    'opt-unusual-flow',
    'opt-earnings-crush',
    'opt-spread-helper',
  ],
  maxSilenceSec: { 'pre-market': null, regular: 120, 'after-hours': null, closed: null },
  required: false,
};
const prices: SourcePolicy = {
  source: 'massive_prices',
  label: 'Price feed',
  dependentRules: ['vwap-reclaim'],
  maxSilenceSec: { 'pre-market': 300, regular: 90, 'after-hours': 300, closed: null },
  required: true,
};
const policies = [options, prices];

describe('evaluateSourceHealth', () => {
  it('is stale when silent beyond the session limit', () => {
    const h = evaluateSourceHealth(
      options,
      D('2026-11-24T20:42:50Z'),
      D('2026-11-24T20:46:00Z'),
      cal,
    ); // 15:46 ET
    expect(h).toMatchObject({ state: 'stale', session: 'regular', silenceSec: 190 });
  });
  it('is ok within the limit', () => {
    expect(
      evaluateSourceHealth(options, D('2026-11-24T20:44:30Z'), D('2026-11-24T20:46:00Z'), cal)
        .state,
    ).toBe('ok');
  });
  it('does not expect a quiet feed outside its session', () => {
    expect(
      evaluateSourceHealth(options, D('2026-11-24T10:00:00Z'), D('2026-11-25T03:00:00Z'), cal)
        .state,
    ).toBe('not-expected');
  });
  it('treats a required source that never reported as stale, an optional one as never', () => {
    expect(evaluateSourceHealth(prices, null, D('2026-11-24T16:00:00Z'), cal).state).toBe('stale');
    expect(
      evaluateSourceHealth({ ...prices, required: false }, null, D('2026-11-24T16:00:00Z'), cal)
        .state,
    ).toBe('never');
  });
});

describe('simulated stale feed raises a system alert (Phase 1 done criterion)', () => {
  it('matches the brief example: options data stale for 3 minutes 10 seconds, 4 rules paused, then recovery', () => {
    const now1 = D('2026-11-24T20:46:00Z'); // 15:46 ET, regular session
    const health1 = [
      evaluateSourceHealth(options, D('2026-11-24T20:42:50Z'), now1, cal),
      evaluateSourceHealth(prices, D('2026-11-24T20:45:50Z'), now1, cal),
    ];
    const prev: Record<string, HealthState> = { massive_options: 'ok', massive_prices: 'ok' };
    const alerts1 = healthTransitions(policies, prev, health1, now1);
    expect(alerts1).toHaveLength(1);
    expect(alerts1[0]).toMatchObject({
      kind: 'system',
      priority: 'critical',
      event: 'stale',
      source: 'massive_options',
      headline: 'Options data stale, silent for 3m 10s, regular session',
      lastGoodAt: '2026-11-24T20:42:50.000Z',
    });
    expect(alerts1[0]?.pausedRules).toHaveLength(4);
    expect(alerts1[0]?.headline.length).toBeLessThanOrEqual(90);
    expect(pausedRules(policies, health1)).toEqual([...options.dependentRules].sort());

    // Still down a minute later: no second alert.
    const now2 = D('2026-11-24T20:47:00Z');
    const health2 = [evaluateSourceHealth(options, D('2026-11-24T20:42:50Z'), now2, cal)];
    expect(healthTransitions(policies, { massive_options: 'stale' }, health2, now2)).toEqual([]);

    // Data resumes: one recovery alert.
    const now3 = D('2026-11-24T20:48:00Z');
    const health3 = [evaluateSourceHealth(options, D('2026-11-24T20:47:55Z'), now3, cal)];
    const alerts3 = healthTransitions(policies, { massive_options: 'stale' }, health3, now3);
    expect(alerts3).toHaveLength(1);
    expect(alerts3[0]).toMatchObject({ event: 'recovered', source: 'massive_options' });
    expect(pausedRules(policies, health3)).toEqual([]);
  });
  it('does not alert for a source that is simply outside its hours', () => {
    const health = [
      evaluateSourceHealth(options, D('2026-11-24T10:00:00Z'), D('2026-11-25T03:00:00Z'), cal),
    ];
    expect(
      healthTransitions(policies, { massive_options: 'ok' }, health, D('2026-11-25T03:00:00Z')),
    ).toEqual([]);
  });
});

describe('runJob: no silent failures', () => {
  const clock = () => {
    let t = Date.parse('2026-11-24T21:00:00Z');
    return () => {
      t += 250;
      return t;
    };
  };
  it('records a successful run with rows and latency', async () => {
    const r = await runJob(
      'prices',
      () => Promise.resolve({ rows: 42, details: { tickers: 10 } }),
      clock(),
    );
    expect(r).toMatchObject({
      job: 'prices',
      status: 'ok',
      rows_written: 42,
      latency_ms: 250,
      error: null,
    });
    expect(r.details).toEqual({ tickers: 10 });
  });
  it('records a thrown error instead of losing it', async () => {
    const r = await runJob('news', () => Promise.reject(new Error('upstream 503')), clock());
    expect(r).toMatchObject({ status: 'error', error: 'upstream 503', rows_written: null });
  });
  it('records a deliberate skip with its reason', async () => {
    const r = await runJob('filings', () => Promise.resolve({ skipped: 'market closed' }), clock());
    expect(r).toMatchObject({ status: 'skipped' });
    expect(r.details).toEqual({ skipped: 'market closed' });
  });
});

describe('describeSourceHealth (the status page text)', () => {
  const halts = DEFAULT_SOURCE_POLICIES.find((p) => p.source === 'nasdaq_halts') as SourcePolicy;
  const gpr = DEFAULT_SOURCE_POLICIES.find((p) => p.source === 'gpr') as SourcePolicy;
  const empty = buildCalendar([], 'NYSE');

  it('says in words that a source is stale, with the silence and the limit', () => {
    const v = describeSourceHealth(
      halts,
      D('2026-11-24T20:06:00Z'),
      D('2026-11-24T20:46:00Z'),
      cal,
    );
    // The Phase 1 halts job runs every 5 minutes, so the limit is 30 minutes (Phase 5 tightens it).
    expect(v).toMatchObject({
      state: 'stale',
      session: 'regular',
      label: 'STALE, silent 40m 0s (limit 30m 0s)',
    });
  });
  it('says quiet is normal outside the session', () => {
    const v = describeSourceHealth(
      halts,
      D('2026-11-24T10:00:00Z'),
      D('2026-11-25T03:00:00Z'),
      cal,
    );
    expect(v.label).toBe('Quiet is normal (closed)');
  });
  it('says plainly when nothing has ever arrived', () => {
    expect(
      describeSourceHealth({ ...halts, required: false }, null, D('2026-11-24T16:00:00Z'), cal)
        .label,
    ).toBe('No data received yet');
  });
  it('refuses to judge a session-dependent source without a calendar, but still judges daily ones', () => {
    expect(
      describeSourceHealth(halts, D('2026-11-24T20:40:00Z'), D('2026-11-24T20:46:00Z'), empty)
        .state,
    ).toBe('calendar-missing');
    // 2 days 20 hours of silence is inside the 4 day limit; 4 days 20 hours is not.
    expect(
      describeSourceHealth(gpr, D('2026-11-22T00:00:00Z'), D('2026-11-24T20:46:00Z'), empty).state,
    ).toBe('ok');
    expect(
      describeSourceHealth(gpr, D('2026-11-20T00:00:00Z'), D('2026-11-24T20:46:00Z'), empty).state,
    ).toBe('stale');
  });
});
