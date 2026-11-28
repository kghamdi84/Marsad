import { describe, expect, it } from 'vitest';
import upcoming from '../../../fixtures/massive/market-status-upcoming.json';
import { DEFAULT_ALERT_SETTINGS, runPipeline } from './alerts.js';
import { buildCalendar, lastCompletedTradingDay, type UpcomingRow } from './calendar.js';
import {
  EARNINGS_DATE_MAX_AGE_SECONDS,
  earningsGuardAlert,
  earningsGuardCandidate,
  earningsGuardEventId,
  earningsGuardScan,
  parseEarningsGuardEventId,
  replayEarningsGuard,
  type EarningsDateInputs,
  type GuardClose,
  type PriorGuardAlert,
} from './earnings-guard.js';
import type { HoldingRef } from './exit-alerts.js';

// Hand-checked against the NYSE fixture: 2026-11-26 closed (Thanksgiving), 2026-11-27 early close, 2026-12-25
// closed; the table covers through 2027-09-06.
const cal = buildCalendar(upcoming.data as UpcomingRow[], 'NYSE');
// Saturday 2026-11-28, 11:45 UTC: after the research (09:35) and summary (11:25) jobs.
const AT = new Date('2026-11-28T11:45:00Z');
const SESSION = '2026-11-27';

const holding = (over: Partial<HoldingRef> = {}): HoldingRef => ({
  id: 12,
  ticker: 'NVDA',
  shares: 13,
  costBasis: 150,
  openedOn: '2026-10-01',
  stop: 160,
  targets: [210],
  trendBreak: null,
  timeStopSessions: null,
  ...over,
});
const tauric = (date: string, asOf = '2026-11-28T01:46:00Z'): EarningsDateInputs => ({
  tauric: { date, asOf },
  estimate: null,
});
const estimate = (date: string, from: string, to: string): EarningsDateInputs => ({
  tauric: null,
  estimate: { date, from, to, computedAt: '2026-11-27T23:31:00Z' },
});
const close = (value: number, date = SESSION): GuardClose => ({
  date,
  close: value,
  fetchedAt: '2026-11-27T22:35:00Z',
});

function scan(
  over: {
    holdings?: HoldingRef[];
    dates?: Record<string, EarningsDateInputs>;
    closes?: Record<string, GuardClose | null>;
    prior?: PriorGuardAlert[];
    session?: string;
    at?: Date;
  } = {},
) {
  return earningsGuardScan({
    at: over.at ?? AT,
    session: over.session ?? SESSION,
    calendar: cal,
    holdings: over.holdings ?? [holding()],
    dates: over.dates ?? { NVDA: tauric('2026-12-03') },
    closes: over.closes ?? { NVDA: close(174.1) },
    prior: over.prior ?? [],
  });
}

describe('earningsGuardScan and the alert text (earnings-guard-1)', () => {
  it('the session the job uses is the last completed one', () => {
    expect(lastCompletedTradingDay(AT, cal)).toBe(SESSION);
  });

  it('states the facts in the brief’s example: 4 sessions, Tauric date, shares, stop distance, exit rules', () => {
    const r = scan();
    expect(r).toMatchObject({ noDate: [], deduped: [], later: 0, stale: [] });
    expect(r.snapshots).toHaveLength(1);
    const s = r.snapshots[0]!;
    // After Fri 2026-11-27: Mon 30, Tue 1, Wed 2, Thu 3.
    const c = earningsGuardCandidate(s);
    expect(c).toMatchObject({
      ticker: 'NVDA',
      earningsDate: '2026-12-03',
      source: 'tauric',
      estimated: false,
      sessionsUntil: 4,
      shares: 13,
      stop: 160,
      close: 174.1,
      hasExitRules: true,
      previous: null,
    });
    // (174.10 - 160) / 174.10 = 0.080988, shown as 8.1%.
    expect(c.stopDistance).toBeCloseTo(14.1 / 174.1, 12);
    const a = earningsGuardAlert(s, { regime: 'calm' });
    expect(a.headline).toBe('NVDA reports in 4 sessions');
    expect(a.trigger).toBe(
      'NVDA reports in 4 sessions (Tauric date 2026-12-03). You hold 13 shares; stop 160.00, 8.1% below the close; exit rules set.',
    );
    expect(a).toMatchObject({
      kind: 'earnings',
      priority: 'normal',
      ruleId: 'earnings-guard',
      ruleVersion: 1,
      ruleStatus: 'live',
      eventId: 'earnings:12:2026-12-03',
      price: 174.1,
      delayed: true,
      maxAgeSeconds: EARNINGS_DATE_MAX_AGE_SECONDS,
      context: { regime: 'calm', news: [] },
    });
    // Oldest input: the bars stored at 22:35 the evening before, 13 h 10 min before the run.
    expect(a.worstAgeSeconds).toBe(13 * 3600 + 10 * 60);
    expect(a.sources.map((x) => [x.id, x.asOf])).toEqual([
      ['tauric-calendar', '2026-11-28T01:46:00Z'],
      ['massive-daily-bars', '2026-11-27T22:35:00Z'],
    ]);
  });

  it('counts across a weekend and Thanksgiving: exactly 5 sessions alerts, 6 does not', () => {
    // After Fri 2026-11-20: Mon 23, Tue 24, Wed 25, (Thu 26 closed), Fri 27 early close, Mon 30, Tue Dec 1.
    const at = new Date('2026-11-21T11:45:00Z');
    const five = scan({
      at,
      session: '2026-11-20',
      dates: { NVDA: tauric('2026-11-30', '2026-11-21T01:46:00Z') },
      closes: { NVDA: close(174.1, '2026-11-20') },
    });
    expect(five.snapshots.map((s) => earningsGuardCandidate(s).sessionsUntil)).toEqual([5]);
    expect(five.snapshots[0]?.closedDays).toEqual(['2026-11-26']);
    expect(earningsGuardAlert(five.snapshots[0]!, {}).headline).toBe('NVDA reports in 5 sessions');
    const six = scan({
      at,
      session: '2026-11-20',
      dates: { NVDA: tauric('2026-12-01', '2026-11-21T01:46:00Z') },
    });
    expect(six).toMatchObject({ snapshots: [], later: 1, noDate: [] });
  });

  it('skips Christmas Day when counting', () => {
    // After Tue 2026-12-22: Wed 23, Thu 24 early close, (Fri 25 closed), Mon 28, Tue 29, Wed 30.
    const r = scan({
      at: new Date('2026-12-23T11:45:00Z'),
      session: '2026-12-22',
      dates: { NVDA: tauric('2026-12-30', '2026-12-23T01:46:00Z') },
      closes: { NVDA: close(174.1, '2026-12-22') },
    });
    expect(r.snapshots.map((s) => earningsGuardCandidate(s).sessionsUntil)).toEqual([5]);
    expect(r.snapshots[0]?.closedDays).toEqual(['2026-12-25']);
  });

  it('a date on the weekend right after the session reads "before the next session"', () => {
    const r = scan({ dates: { NVDA: tauric('2026-11-29') } });
    const a = earningsGuardAlert(r.snapshots[0]!, {});
    expect(a.headline).toBe('NVDA reports before the next session');
  });

  it('a missing date is reported, not alerted; so is a stated date already past with no estimate', () => {
    const r = scan({
      holdings: [holding(), holding({ id: 13, ticker: 'SOFI' })],
      dates: { SOFI: tauric('2026-11-02') },
    });
    expect(r).toMatchObject({ snapshots: [], noDate: ['NVDA', 'SOFI'], later: 0, stale: [] });
  });

  it('an estimated date is labelled as Marsad’s estimate with its window, and the bear case says so', () => {
    const r = scan({ dates: { NVDA: estimate('2026-12-02', '2026-11-25', '2026-12-09') } });
    const c = earningsGuardCandidate(r.snapshots[0]!);
    expect(c).toMatchObject({ source: 'marsad-estimate', estimated: true, sessionsUntil: 3 });
    const a = earningsGuardAlert(r.snapshots[0]!, {});
    expect(a.headline).toBe('NVDA reports in 3 sessions (estimated date)');
    expect(a.trigger).toBe(
      'NVDA reports in 3 sessions (Marsad estimate 2026-12-02, estimated from past results filings, window 2026-11-25 to 2026-12-09). You hold 13 shares; stop 160.00, 8.1% below the close; exit rules set.',
    );
    expect(a.bearCase).toContain('not a company announcement');
    expect(a.sources[0]).toMatchObject({
      id: 'marsad-earnings-estimate',
      asOf: '2026-11-27T23:31:00Z',
    });
  });

  it('Tauric’s date comes first; the estimate is used only when Tauric’s is missing or past', () => {
    const both = (stated: string) =>
      scan({
        dates: {
          NVDA: {
            tauric: { date: stated, asOf: '2026-11-28T01:46:00Z' },
            estimate: {
              date: '2026-12-02',
              from: '2026-11-25',
              to: '2026-12-09',
              computedAt: '2026-11-27T23:31:00Z',
            },
          },
        },
      }).snapshots[0]?.earnings;
    expect(both('2026-12-03')).toMatchObject({ date: '2026-12-03', source: 'tauric' });
    expect(both('2026-11-20')).toMatchObject({ date: '2026-12-02', source: 'marsad-estimate' });
  });

  it('no stop, a missing close, a close under the stop and no exit rules are stated as such', () => {
    const text = (h: HoldingRef, c: GuardClose | null) =>
      earningsGuardAlert(scan({ holdings: [h], closes: { NVDA: c } }).snapshots[0]!, {}).trigger;
    expect(text(holding({ stop: null, targets: [] }), close(174.1))).toBe(
      'NVDA reports in 4 sessions (Tauric date 2026-12-03). You hold 13 shares; no stop set; no exit rules set.',
    );
    // A close from an older session is not used.
    expect(text(holding(), close(174.1, '2026-11-25'))).toContain(
      'stop 160.00; distance unavailable (no close stored for 2026-11-27)',
    );
    // (155 - 160) / 155 = -0.032258: the stop is 3.2% above the close.
    expect(text(holding({ shares: 1 }), close(155))).toContain(
      'You hold 1 share; stop 160.00, 3.2% above the close',
    );
  });

  it('one alert per holding per date: the same date again is deduped; a changed date refers to the old alert', () => {
    const prior: PriorGuardAlert[] = [
      {
        alertId: 'a1',
        holdingId: 12,
        date: '2026-12-08',
        createdAt: '2026-11-21T11:46:00.000Z',
      },
    ];
    expect(scan({ prior: [{ ...prior[0]!, date: '2026-12-03' }] })).toMatchObject({
      snapshots: [],
      deduped: ['NVDA'],
    });
    // Another holding's alert for the same date does not dedupe this one.
    expect(
      scan({ prior: [{ ...prior[0]!, holdingId: 99, date: '2026-12-03' }] }).snapshots,
    ).toHaveLength(1);
    const moved = scan({ prior });
    const a = earningsGuardAlert(moved.snapshots[0]!, {});
    expect(a.eventId).toBe('earnings:12:2026-12-03');
    expect(moved.snapshots[0]?.previous).toEqual({
      alertId: 'a1',
      date: '2026-12-08',
      createdAt: '2026-11-21T11:46:00.000Z',
    });
    expect(a.trigger).toContain(
      'Date changed: the alert of 2026-11-21 11:46 UTC (06:46 ET) gave 2026-12-08.',
    );
  });

  it('a source older than 7 days, or without an as-of time, is named instead of alerted', () => {
    const r = scan({
      holdings: [holding(), holding({ id: 13, ticker: 'SOFI' })],
      dates: {
        NVDA: tauric('2026-12-03', '2026-11-20T01:00:00Z'),
        SOFI: { tauric: { date: '2026-12-03', asOf: null }, estimate: null },
      },
    });
    expect(r.snapshots).toEqual([]);
    expect(r.stale).toEqual([
      'NVDA: Tauric calendar as of 2026-11-20T01:00:00Z, older than 7 days',
      'SOFI: Tauric calendar has no as-of time',
    ]);
  });

  it('says when the holiday table does not reach the date', () => {
    const short = { ...cal, coveredThrough: '2026-11-30' };
    const r = earningsGuardScan({
      at: AT,
      session: SESSION,
      calendar: short,
      holdings: [holding()],
      dates: { NVDA: tauric('2026-12-03') },
      closes: { NVDA: close(174.1) },
      prior: [],
    });
    expect(earningsGuardAlert(r.snapshots[0]!, {}).trigger).toContain(
      'The holiday table covers through 2026-11-30; the count assumes no other market holidays.',
    );
  });

  it('never words advice', () => {
    const r = scan({
      prior: [
        { alertId: 'a1', holdingId: 12, date: '2026-12-08', createdAt: '2026-11-21T11:46:00Z' },
      ],
      dates: { NVDA: estimate('2026-12-02', '2026-11-25', '2026-12-09') },
    });
    const a = earningsGuardAlert(r.snapshots[0]!, {});
    for (const t of [a.headline, a.trigger, a.bearCase])
      expect(t).not.toMatch(/\b(consider|sell|selling|trim|buy|should|recommend|reduce)\b/i);
  });

  it('event ids round-trip', () => {
    expect(parseEarningsGuardEventId(earningsGuardEventId(12, '2026-12-03'))).toEqual({
      holdingId: 12,
      date: '2026-12-03',
    });
    expect(parseEarningsGuardEventId('exit:12:stop:2026-12-03')).toBeNull();
  });
});

describe('the earnings guard through the pipeline, and replay', () => {
  it('passes the freshness gate and is pushed outside quiet hours (14:45 Riyadh)', () => {
    const a = earningsGuardAlert(scan().snapshots[0]!, {});
    const r = runPipeline(a, DEFAULT_ALERT_SETTINGS, { recent: [], pushesToday: 0 }, AT);
    expect(r.decision).toBe('push');
    expect(r.key).toBe('earnings|NVDA|earnings-guard|earnings:12:2026-12-03');
    expect(r.reasons).toEqual(['data fresh', 'rule live', 'pushed']);
  });

  it('replay recomputes the stored input from its own snapshot (after a JSON round trip)', () => {
    const r = scan({
      prior: [
        { alertId: 'a1', holdingId: 12, date: '2026-12-08', createdAt: '2026-11-21T11:46:00Z' },
      ],
    });
    const stored = JSON.parse(
      JSON.stringify(
        earningsGuardAlert(r.snapshots[0]!, {
          regime: 'stress',
          vix: { value: 24.1, asOf: '2026-11-27', source: 'FRED VIXCLS', delayed: true },
        }),
      ),
    ) as ReturnType<typeof earningsGuardAlert>;
    expect(replayEarningsGuard(stored)).toEqual(stored);
    // A different formula's input is not replayed as a guard alert.
    expect(replayEarningsGuard({ ...stored, snapshot: { version: 'other' } })).toBeNull();
    expect(replayEarningsGuard({ ...stored, snapshot: undefined })).toBeNull();
  });
});
