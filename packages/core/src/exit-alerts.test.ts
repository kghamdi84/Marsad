import { describe, expect, it } from 'vitest';
import { DEFAULT_ALERT_SETTINGS, renderCard, runPipeline } from './alerts.js';
import { EXIT_MAX_AGE_SECONDS, exitAlerts, type HoldingRef } from './exit-alerts.js';
import type { DailyBar } from './study.js';

const bar = (date: string, close: number): DailyBar => ({
  date,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1_000_000,
  vwap: null,
});
const h: HoldingRef = {
  id: 7,
  ticker: 'RKLB',
  shares: 100,
  costBasis: 24,
  openedOn: '2026-11-02',
  stop: 22,
  targets: [30],
  trendBreak: null,
  timeStopSessions: null,
};
const FETCHED = '2026-11-24T22:35:00Z';
const NOW = new Date('2026-11-24T22:40:00Z'); // 01:40 Riyadh: quiet hours

describe('exitAlerts', () => {
  it('fires when the stop newly holds on the newest bar, with the case against selling', () => {
    const [a, ...rest] = exitAlerts(
      h,
      [bar('2026-11-23', 22.5), bar('2026-11-24', 21.9)],
      {},
      FETCHED,
      NOW,
    );
    expect(rest).toEqual([]);
    expect(a).toMatchObject({
      kind: 'exit',
      priority: 'high',
      ticker: 'RKLB',
      ruleId: 'exit-stop',
      eventId: 'exit:7:stop:2026-11-24',
      headline: 'RKLB closed at or below its stop',
      trigger: 'Closed at 21.90, at or below the stop 22.00.',
      worstAgeSeconds: 300,
      maxAgeSeconds: EXIT_MAX_AGE_SECONDS,
      delayed: true,
    });
    expect(a?.bearCase).toMatch(/^A close below the stop can reverse/);
  });

  it('does not fire again while the stop keeps holding', () => {
    expect(
      exitAlerts(h, [bar('2026-11-23', 21.5), bar('2026-11-24', 21.9)], {}, FETCHED, NOW),
    ).toEqual([]);
  });

  it('a target is normal priority', () => {
    const [a] = exitAlerts(h, [bar('2026-11-23', 29), bar('2026-11-24', 30.2)], {}, FETCHED, NOW);
    expect(a).toMatchObject({ ruleId: 'exit-target', priority: 'normal' });
  });

  it('end-of-day data passes the freshness gate within 6 hours of storing, and fails after', () => {
    const [a] = exitAlerts(h, [bar('2026-11-23', 22.5), bar('2026-11-24', 21.9)], {}, FETCHED, NOW);
    if (!a) throw new Error('no alert');
    const r = runPipeline(a, DEFAULT_ALERT_SETTINGS, { recent: [], pushesToday: 0 }, NOW);
    expect(r.reasons[0]).toBe('data fresh');
    expect(r.decision).toBe('digest'); // 01:40 Riyadh is in quiet hours and high is not critical
    const late = new Date(Date.parse(FETCHED) + (EXIT_MAX_AGE_SECONDS + 60) * 1000);
    const [b] = exitAlerts(
      h,
      [bar('2026-11-23', 22.5), bar('2026-11-24', 21.9)],
      {},
      FETCHED,
      late,
    );
    if (!b) throw new Error('no alert');
    const r2 = runPipeline(b, DEFAULT_ALERT_SETTINGS, { recent: [], pushesToday: 0 }, late);
    expect(r2).toMatchObject({ decision: 'suppress' });
    expect(r2.reasons[0]).toBe('data too old: 21660 s against 21600 s for end-of-day data');
  });

  it('the card labels the data as delayed end-of-day bars', () => {
    const [a] = exitAlerts(h, [bar('2026-11-23', 22.5), bar('2026-11-24', 21.9)], {}, FETCHED, NOW);
    if (!a) throw new Error('no alert');
    const src = renderCard(a).find((s) => s.heading === 'Sources and freshness');
    expect(src?.lines).toEqual([
      'Massive daily bars, completed session 2026-11-24 (end of day) (2026-11-24T22:35:00Z)',
      'Oldest input 300 s old, delayed data.',
    ]);
  });

  it('needs two bars', () => {
    expect(exitAlerts(h, [bar('2026-11-24', 21)], {}, FETCHED, NOW)).toEqual([]);
  });
});
