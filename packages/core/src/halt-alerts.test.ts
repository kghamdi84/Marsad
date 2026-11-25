import { describe, expect, it } from 'vitest';
import { DEFAULT_ALERT_SETTINGS, renderCard, runPipeline } from './alerts.js';
import { haltAlerts, type HaltRow } from './halt-alerts.js';

const halt: HaltRow = {
  symbol: 'SOFI',
  haltedAt: '2026-11-25T19:32:05Z', // 14:32:05 ET, 22:32 Riyadh
  reasonCode: 'T1',
  reasonMeaning: 'News pending',
  newsRelated: true,
  resumptionTradeAt: null,
  lastSeenAt: '2026-11-25T19:34:00Z',
};
const NOW = new Date('2026-11-25T19:35:00Z');

describe('haltAlerts', () => {
  it('a news halt is a critical tier-1 halt alert with ET and local time', () => {
    const [a] = haltAlerts(halt, { regime: 'stress' }, NOW);
    expect(a).toMatchObject({
      kind: 'halt',
      priority: 'critical',
      ticker: 'SOFI',
      eventId: 'halt:2026-11-25T19:32:05Z',
      headline: 'SOFI halted: News pending',
      trigger: 'Trading halted at 14:32 ET (22:32 local), reason T1 (News pending).',
      worstAgeSeconds: 60, // the feed was read a minute ago
    });
    expect(a?.sources[0]?.label).toContain('tier 1');
  });

  it('a resumption is a second event; a non-news halt is high, not critical', () => {
    const both = haltAlerts({ ...halt, resumptionTradeAt: '2026-11-25T19:47:00Z' }, {}, NOW);
    expect(both.map((a) => a.eventId)).toEqual([
      'halt:2026-11-25T19:32:05Z',
      'resume:2026-11-25T19:47:00Z',
    ]);
    expect(
      haltAlerts(
        { ...halt, newsRelated: false, reasonCode: 'LUDP', reasonMeaning: 'Volatility pause' },
        {},
        NOW,
      )[0]?.priority,
    ).toBe('high');
  });

  it('runs through the pipeline: critical bypasses quiet hours (22:35 is before 23:00, so push either way)', () => {
    const [a] = haltAlerts(halt, {}, NOW);
    if (!a) throw new Error('no alert');
    const r = runPipeline(a, DEFAULT_ALERT_SETTINGS, { recent: [], pushesToday: 9 }, NOW);
    expect(r.decision).toBe('push'); // past the cap of 8, but critical
    expect(renderCard(a).find((s) => s.heading === 'Risk, this rule’s history')?.lines[0]).toBe(
      'scalp n/a; swing n/a; long-term n/a.',
    );
  });
});
