import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ALERT_SETTINGS as S,
  dedupeKey,
  inQuietHours,
  pushText,
  renderCard,
  riskText,
  runPipeline,
  type AlertInput,
} from './alerts.js';
import { wilson } from './stats.js';

// 2026-11-25 14:00 UTC is 17:00 in Riyadh (outside quiet hours 23:00 to 07:00).
const NOW = new Date('2026-11-25T14:00:00Z');
const base: AlertInput = {
  kind: 'setup',
  priority: 'high',
  ticker: 'SOFI',
  ruleId: 'trend-template-breakout',
  ruleVersion: 1,
  ruleStatus: 'live',
  headline: 'SOFI closed at a 20-day high above rising averages',
  trigger:
    'Close 24.10 above the 20-day high 23.80; 50-day 21.40 above 150-day 19.90 above 200-day 18.70.',
  signalPrice: 24.1,
  price: 24.3,
  chaseLimit: 0.03,
  dollarVolume: 900_000_000,
  risk: [
    { horizon: 'scalp', losses: 0, n: null },
    { horizon: 'swing', losses: 94, n: 180 },
    { horizon: 'long', losses: 3, n: 12 },
  ],
  context: { regime: 'bull correction' },
  bearCase: 'Breakouts in a correction fail more often; the 50-day average is the line.',
  sources: [{ id: 'bars', label: 'Massive daily bars', asOf: '2026-11-24' }],
  worstAgeSeconds: 60,
  delayed: true,
};
const empty = { recent: [], pushesToday: 0 };

describe('runPipeline', () => {
  it('pushes a fresh, live, liquid, unchased signal outside quiet hours', () => {
    const r = runPipeline(base, S, empty, NOW);
    expect(r.decision).toBe('push');
    expect(r.key).toBe('setup|SOFI|trend-template-breakout|2026-11-25');
    expect(r.reasons).toEqual(['data fresh', 'rule live', 'pushed']);
  });

  it('suppresses stale data, illiquid names, chased prices, snoozed tickers and duplicates', () => {
    expect(runPipeline({ ...base, worstAgeSeconds: 301 }, S, empty, NOW).decision).toBe('suppress');
    expect(
      runPipeline({ ...base, dollarVolume: 4_999_999 }, S, empty, NOW).reasons.at(-1),
    ).toContain('too illiquid');
    // 24.10 to 24.90 is 3.3%, past the 3% limit.
    const chased = runPipeline({ ...base, price: 24.9 }, S, empty, NOW);
    expect(chased.decision).toBe('suppress');
    expect(chased.reasons.at(-1)).toBe('chase guard: 3.3% past the signal price, limit 3.0%');
    const snoozed = { ...S, snoozed: { SOFI: '2026-11-26T00:00:00Z' } };
    expect(runPipeline(base, snoozed, empty, NOW).decision).toBe('suppress');
    const dup = {
      recent: [
        { key: 'setup|SOFI|trend-template-breakout|2026-11-25', at: '2026-11-25T08:00:00Z' },
      ],
      pushesToday: 0,
    };
    expect(runPipeline(base, S, dup, NOW).reasons.at(-1)).toBe('duplicate: already alerted today');
  });

  it('applies the cooldown across midnight', () => {
    // Alerted at 23:30 Riyadh on 2026-11-24 (20:30 UTC); 4-hour cooldown still running at 00:30 Riyadh.
    const recent = [
      { key: 'setup|SOFI|trend-template-breakout|2026-11-24', at: '2026-11-24T20:30:00Z' },
    ];
    const r = runPipeline(base, S, { recent, pushesToday: 0 }, new Date('2026-11-24T21:30:00Z'));
    expect(r.reasons.at(-1)).toBe('cooldown: 240 minutes');
  });

  it('event alerts dedupe on the event only, with no cooldown', () => {
    const halt = {
      ...base,
      kind: 'halt' as const,
      ruleId: 'halts',
      eventId: '2026-11-25T14:32:05Z',
    };
    const r = runPipeline(halt, S, empty, NOW);
    expect(r.key).toBe('halt|SOFI|halts|2026-11-25T14:32:05Z');
    const seen = { recent: [{ key: r.key, at: NOW.toISOString() }], pushesToday: 1 };
    // A second halt 10 minutes later is a new event, not a cooldown; the same event again is a duplicate.
    expect(runPipeline({ ...halt, eventId: '2026-11-25T14:42:00Z' }, S, seen, NOW).decision).toBe(
      'push',
    );
    expect(runPipeline(halt, S, seen, NOW).decision).toBe('suppress');
  });

  it('logs shadow rules without delivering them', () => {
    expect(runPipeline({ ...base, ruleStatus: 'shadow' }, S, empty, NOW).decision).toBe('shadow');
  });

  it('holds setups to the digest before a high-impact event, but not exits', () => {
    const ctx = {
      regime: 'x',
      nextEvent: { name: 'CPI', at: '2026-11-25T14:20:00Z', impact: 'high' as const },
    };
    expect(runPipeline({ ...base, context: ctx }, S, empty, NOW).decision).toBe('digest');
    expect(runPipeline({ ...base, kind: 'exit', context: ctx }, S, empty, NOW).decision).toBe(
      'push',
    );
  });

  it('quiet hours and the daily cap send to the digest; critical bypasses both', () => {
    const night = new Date('2026-11-25T21:00:00Z'); // 00:00 in Riyadh
    expect(runPipeline(base, S, empty, night).decision).toBe('digest');
    expect(runPipeline({ ...base, priority: 'critical' }, S, empty, night).decision).toBe('push');
    const capped = { recent: [], pushesToday: 8 };
    expect(runPipeline(base, S, capped, NOW).decision).toBe('digest');
    expect(runPipeline({ ...base, priority: 'critical' }, S, capped, NOW).decision).toBe('push');
  });

  it('a turned-off kind goes to the digest; system alerts cannot be turned off', () => {
    const off = { ...S, enabledKinds: [] };
    expect(runPipeline(base, off, empty, NOW).decision).toBe('digest');
    expect(
      runPipeline({ ...base, kind: 'system', ruleId: 'health' }, off, empty, NOW).decision,
    ).toBe('push');
  });
});

describe('quiet hours and keys', () => {
  it('handles windows across midnight and within a day', () => {
    expect(inQuietHours(23 * 60, '23:00', '07:00')).toBe(true);
    expect(inQuietHours(6 * 60 + 59, '23:00', '07:00')).toBe(true);
    expect(inQuietHours(7 * 60, '23:00', '07:00')).toBe(false);
    expect(inQuietHours(13 * 60, '12:00', '14:00')).toBe(true);
    expect(inQuietHours(14 * 60, '12:00', '14:00')).toBe(false);
  });
  it('the dedupe key uses the local date', () => {
    expect(dedupeKey({ kind: 'halt', ruleId: 'halts' }, '2026-11-25')).toBe(
      'halt|-|halts|2026-11-25',
    );
  });
});

describe('risk text', () => {
  it('shows n and a 90% Wilson interval from 30 trades, "insufficient history" below, and n/a', () => {
    const w = wilson(94, 180);
    const p = (v: number) => (Math.round(v * 1000) / 10).toFixed(1);
    expect(riskText({ horizon: 'swing', losses: 94, n: 180 })).toBe(
      `swing 52.2% loss rate (n=180, 90% CI ${p(w?.low ?? 0)} to ${p(w?.high ?? 0)}%)`,
    );
    expect(riskText({ horizon: 'long', losses: 3, n: 12 })).toBe(
      'long-term: insufficient history (n=12)',
    );
    expect(riskText({ horizon: 'scalp', losses: 0, n: null })).toBe('scalp n/a');
  });
});

describe('card and push', () => {
  it('renders the sections in the brief’s order', () => {
    const card = renderCard({
      ...base,
      plan: {
        entry: 'Next open if not above 24.83',
        stop: 22.2,
        targets: [26.5, 28],
        invalidation: 'Close below the 50-day.',
      },
      checklist: {
        cleanSetup: true,
        notExtended: true,
        riskDefined: true,
        profitPlan: true,
        bearCaseRead: false,
      },
      context: {
        regime: 'bull correction',
        news: [{ id: 'n', title: 'SoFi raises guidance', tier: 1 }],
      },
    });
    expect(card.map((s) => s.heading)).toEqual([
      '[SETUP, high] SOFI',
      'Trigger',
      'Plan',
      'Risk, this rule’s history',
      'Context',
      'News',
      'Checklist',
      'Bear case',
      'Sources and freshness',
    ]);
    expect(card[3]?.lines[0]).toContain('scalp n/a; swing 52.2% loss rate');
    expect(JSON.stringify(card)).not.toMatch(/—/);
  });

  it('keeps the push within 60 and 140 characters', () => {
    const p = pushText({ ...base, trigger: 'x '.repeat(100) });
    expect(p.title.length).toBeLessThanOrEqual(60);
    expect(p.body.length).toBeLessThanOrEqual(140);
    expect(pushText(base).title.startsWith('[SETUP, high] SOFI: ')).toBe(true);
  });
});
