import { describe, expect, it } from 'vitest';
import { PLAN_COSTS, actionsMinutes, aiSpend } from './costs.js';

const NOW = new Date('2026-11-25T12:00:00Z');

describe('aiSpend (hand-checked)', () => {
  const rows = [
    { createdAt: '2026-11-25T08:00:00Z', model: 'claude-sonnet-5-5', usd: 0.4 },
    { createdAt: '2026-11-25T09:00:00Z', model: 'claude-haiku-5-5', usd: 0.1 },
    { createdAt: '2026-11-10T09:00:00Z', model: 'claude-sonnet-5-5', usd: 3 },
    { createdAt: '2026-10-31T23:00:00Z', model: 'claude-opus-5-5', usd: 50 }, // last month: left out
  ];
  it('today and this month by model; no caps means no budget (AI stays off)', () => {
    const s = aiSpend(rows, NOW, null);
    expect(s.todayUsd).toBeCloseTo(0.5, 12);
    expect(s.monthUsd).toBeCloseTo(3.5, 12);
    expect(s.calls).toBe(3);
    expect(s.byModel[0]).toMatchObject({ model: 'claude-sonnet-5-5', calls: 2 });
    expect(s.byModel[0]?.usd).toBeCloseTo(3.4, 12);
    expect(s.budget).toBeNull();
  });
  it('warns at 80% of a cap and caps at 100%', () => {
    expect(aiSpend(rows, NOW, { dailyUsd: 10, monthlyUsd: 4 }).budget?.state).toBe('warn'); // 3.5 / 4 = 87.5%
    expect(aiSpend(rows, NOW, { dailyUsd: 0.4, monthlyUsd: 100 }).budget?.state).toBe('capped');
    expect(aiSpend(rows, NOW, { dailyUsd: 10, monthlyUsd: 100 }).budget?.state).toBe('ok');
  });
});

describe('actionsMinutes', () => {
  it('rounds each run up to a whole minute (at least one) and counts this month only', () => {
    const r = actionsMinutes(
      [
        { startedAt: '2026-11-25T10:00:00Z', latencyMs: 1_500 }, // 1
        { startedAt: '2026-11-24T10:00:00Z', latencyMs: 61_000 }, // 2
        { startedAt: '2026-11-01T00:00:00Z', latencyMs: 7_440_000 }, // 124
        { startedAt: '2026-10-31T00:00:00Z', latencyMs: 60_000 }, // last month
        { startedAt: '2026-11-02T00:00:00Z', latencyMs: null },
      ],
      NOW,
    );
    expect(r).toEqual({ runs: 3, minutes: 127 });
  });
});

describe('PLAN_COSTS', () => {
  it('lists every service with a cost of zero today (no paid plan bought)', () => {
    expect(PLAN_COSTS.reduce((a, p) => a + p.usdPerMonth, 0)).toBe(0);
  });
});
