import { describe, expect, it } from 'vitest';
import {
  DIGEST_MAX_FULL,
  criticalAlertEmail,
  digestEmail,
  systemAlertEmail,
  type StoredAlertText,
} from './email-digest.js';

const card = [
  { heading: '[HALT, critical] SOFI', lines: ['SOFI halted: News pending'] },
  { heading: 'Bear case', lines: ['A halt freezes price discovery.'] },
];
const alert = (over: Partial<StoredAlertText> = {}): StoredAlertText => ({
  id: 'a1',
  createdAt: '2026-11-25T19:34:30Z',
  kind: 'halt',
  priority: 'critical',
  headline: 'SOFI halted: News pending',
  card,
  ...over,
});

describe('criticalAlertEmail', () => {
  it('carries the full stored card, ET and UTC times and the card link', () => {
    // 19:34 UTC on 2026-11-25 is 14:34 in New York (EST, UTC-5).
    const m = criticalAlertEmail(alert(), new Date('2026-11-25T19:35:00Z'));
    expect(m.subject).toBe('Marsad critical: SOFI halted: News pending');
    expect(m.text).toBe(
      [
        'Critical alert, Nov 25, 14:34 ET (2026-11-25 19:34 UTC).',
        '',
        '[HALT, critical] SOFI',
        '  SOFI halted: News pending',
        'Bear case',
        '  A halt freezes price discovery.',
        '',
        'Open the card: https://marsad-k84.netlify.app/alerts#alert-a1',
        'Marsad never places orders; every decision is yours.',
      ].join('\n'),
    );
  });
  it('says how late a copy is from 10 minutes on', () => {
    expect(criticalAlertEmail(alert(), new Date('2026-11-25T19:44:29Z')).text).not.toContain(
      'Sent',
    );
    expect(criticalAlertEmail(alert(), new Date('2026-11-25T19:44:30Z')).text).toContain(
      'Sent 10 min after the alert.',
    );
    expect(criticalAlertEmail(alert(), new Date('2026-11-25T23:00:00Z')).text).toContain(
      'Sent 3 h after the alert.',
    );
  });
});

describe('systemAlertEmail', () => {
  it('names the feed, the paused rules and the Status page', () => {
    const m = systemAlertEmail(
      {
        id: '7',
        createdAt: '2026-07-01T14:00:00Z',
        event: 'stale',
        source: 'massive-bars',
        headline: 'Massive bars stale',
        trigger: 'No bars for 3 hours during the session.',
        pausedRules: ['exit-ema20', 'catalyst-watch'],
      },
      new Date('2026-07-01T14:01:00Z'),
    );
    // 14:00 UTC in July is 10:00 in New York (EDT, UTC-4).
    expect(m.subject).toBe('Marsad system: feed stale, massive-bars');
    expect(m.text).toContain('System alert, Jul 1, 10:00 ET (2026-07-01 14:00 UTC).');
    expect(m.text).toContain('Paused rules: exit-ema20, catalyst-watch.');
    expect(m.text).toContain('https://marsad-k84.netlify.app/status');
  });
});

describe('digestEmail', () => {
  it('is null when nothing was held', () => {
    expect(digestEmail([], new Date())).toBeNull();
  });
  it('lists alerts oldest first with why each was held', () => {
    const now = new Date('2026-11-26T13:00:00Z');
    const m = digestEmail(
      [
        alert({
          id: 'b',
          createdAt: '2026-11-26T01:00:00Z',
          reasons: ['data fresh', 'quiet hours: to the digest'],
        }),
        alert({ id: 'a', createdAt: '2026-11-25T23:30:00Z', reasons: ['data fresh'] }),
      ],
      now,
    );
    expect(m?.subject).toBe('Marsad digest: 2 alerts held, 2026-11-26');
    const text = m?.text ?? '';
    expect(text.indexOf('alerts#alert-a')).toBeLessThan(text.indexOf('alerts#alert-b'));
    expect(text).toContain(
      '1. SOFI halted: News pending (halt, critical), Nov 25, 18:30 ET (2026-11-25 23:30 UTC)',
    );
    expect(text).toContain('Held for the digest.');
    expect(text).toContain('Held: quiet hours: to the digest.');
  });
  it(`lists ${DIGEST_MAX_FULL} in full and names the rest, dropping none`, () => {
    const many = Array.from({ length: DIGEST_MAX_FULL + 3 }, (_, i) =>
      alert({
        id: `x${i}`,
        headline: `Alert ${i}`,
        createdAt: new Date(Date.UTC(2026, 10, 25, 0, i)).toISOString(),
      }),
    );
    const text = digestEmail(many, new Date('2026-11-25T12:00:00Z'))?.text ?? '';
    expect(text.match(/^Card: /gm)).toHaveLength(DIGEST_MAX_FULL);
    expect(text).toContain('3 more, listed by headline');
    for (let i = 0; i < many.length; i++) expect(text).toContain(`Alert ${i}`);
  });
});
