import { describe, expect, it } from 'vitest';
import upcoming from '../../../fixtures/massive/market-status-upcoming.json';
import { buildCalendar, type UpcomingRow } from './calendar.js';
import { evaluateFreshness, formatAge, worstState, type PlanTier } from './provenance.js';

const cal = buildCalendar(upcoming.data as UpcomingRow[], 'NYSE');
const D = (iso: string) => new Date(iso);

function fresh(asOf: string | null, now: string, planTier: PlanTier = 'real-time') {
  return evaluateFreshness({ asOf: asOf ? D(asOf) : null, now: D(now), planTier, calendar: cal });
}

describe('formatAge', () => {
  it('formats seconds, minutes, hours and days', () => {
    expect(formatAge(45)).toBe('45s');
    expect(formatAge(190)).toBe('3m 10s');
    expect(formatAge(3 * 3600 + 120)).toBe('3h 2m');
    expect(formatAge(2 * 86400 + 5 * 3600)).toBe('2d 5h');
  });
});

describe('evaluateFreshness: the brief example', () => {
  // A 2-minute-old quote is stale at 10:00 ET and normal at 22:00 ET.
  it('stale at 10:00 ET in the regular session', () => {
    const f = fresh('2026-11-24T14:58:00Z', '2026-11-24T15:00:00Z'); // 09:58 and 10:00 ET
    expect(f.state).toBe('stale');
    expect(f.session).toBe('regular');
    expect(f.label).toBe('Stale, 2m 0s old');
  });
  it('normal at 22:00 ET, when the market is closed and the value is the last close', () => {
    const f = fresh('2026-11-25T02:58:00Z', '2026-11-25T03:00:00Z'); // 21:58 and 22:00 ET Tuesday
    expect(f.state).toBe('live');
    expect(f.session).toBe('closed');
    expect(f.label).toBe('Market closed, last value 16:00 ET');
  });
});

describe('evaluateFreshness: real-time tier', () => {
  it('is live within 90 s in the regular session', () => {
    expect(fresh('2026-11-24T15:00:00Z', '2026-11-24T15:01:20Z').state).toBe('live');
    expect(fresh('2026-11-24T15:00:00Z', '2026-11-24T15:01:31Z').state).toBe('stale');
  });
  it('allows 5 minutes in extended hours', () => {
    expect(fresh('2026-11-24T12:00:00Z', '2026-11-24T12:04:50Z').state).toBe('live'); // pre-market
    expect(fresh('2026-11-24T12:00:00Z', '2026-11-24T12:05:10Z').state).toBe('stale');
  });
  it('is stale when closed and the value predates the last close', () => {
    // Wednesday 2026-11-25 22:00 ET with a value from Tuesday afternoon.
    const f = fresh('2026-11-24T19:00:00Z', '2026-11-26T03:00:00Z');
    expect(f.state).toBe('stale');
  });
  it('is live all weekend if the value is the last close print', () => {
    const f = fresh('2026-11-27T17:59:58Z', '2026-11-29T15:00:00Z'); // early close Friday, Sunday now
    expect(f.state).toBe('live');
    expect(f.label).toBe('Market closed, last value 13:00 ET');
  });
});

describe('evaluateFreshness: delayed tier', () => {
  it('is labelled delayed, not live, and tolerates the 15 minute delay', () => {
    const f = fresh('2026-11-24T14:45:00Z', '2026-11-24T15:01:00Z', 'delayed'); // 16 min old
    expect(f.state).toBe('delayed');
    expect(f.label).toBe('Delayed 15 min');
  });
  it('is stale once older than the delay plus the grace', () => {
    expect(fresh('2026-11-24T14:30:00Z', '2026-11-24T15:01:00Z', 'delayed').state).toBe('stale'); // 31 min
  });
});

describe('evaluateFreshness: end-of-day tier', () => {
  it('is current when it holds the last completed trading day', () => {
    const f = fresh('2026-11-23T05:00:00Z', '2026-11-24T14:00:00Z', 'end-of-day'); // Monday's bar, Tuesday morning
    expect(f.state).toBe('live');
    expect(f.label).toBe('End of day, 2026-11-23');
  });
  it('is stale when a trading day is missing', () => {
    const f = fresh('2026-11-20T05:00:00Z', '2026-11-24T14:00:00Z', 'end-of-day'); // Friday's bar, after Monday closed
    expect(f.state).toBe('stale');
  });
});

describe('evaluateFreshness: missing data', () => {
  it('is unavailable for no value or an unavailable plan', () => {
    expect(fresh(null, '2026-11-24T15:00:00Z').state).toBe('unavailable');
    expect(fresh('2026-11-24T14:59:00Z', '2026-11-24T15:00:00Z', 'unavailable').label).toBe(
      'Unavailable',
    );
  });
});

describe('worstState', () => {
  it('returns the least fresh state', () => {
    expect(worstState(['live', 'delayed'])).toBe('delayed');
    expect(worstState(['live', 'stale', 'delayed'])).toBe('stale');
    expect(worstState(['live', 'unavailable'])).toBe('unavailable');
    expect(worstState([])).toBe('unavailable');
  });
});
