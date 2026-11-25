import { describe, expect, it } from 'vitest';
import { fakeStore } from './fake-store.js';
import { runWeeklyReviewJob } from './weekly-review-job.js';

const NOW = new Date('2026-11-29T07:30:00Z'); // Sunday: the week is 2026-11-23 to 2026-11-29

describe('runWeeklyReviewJob', () => {
  it('stores the review as a brief with its inputs and emails it when configured', async () => {
    const { store, log } = fakeStore({
      exportTables: {
        trades: [
          {
            id: 1,
            owner_id: 'u1',
            ticker: 'RKLB',
            side: 'long',
            setup: 'trend-template-breakout',
            entry_date: '2026-11-10',
            entry_price: 24,
            shares: 100,
            stop: 22,
            exit_date: '2026-11-24',
            exit_price: 28,
            checklist: {},
            followed: {},
          },
        ],
        alert_feedback: [
          { verdict: 'noise', created_at: '2026-11-25T10:00:00Z' },
          { verdict: 'useful', created_at: '2026-11-01T10:00:00Z' }, // before the week
        ],
      },
      recentAlerts: [
        { key: 'halt|SOFI|halts|halt:x', at: '2026-11-24T15:00:00.000Z', decision: 'push' },
      ],
      latestRows: { regime_daily: [{ date: '2026-11-27', label: 'stress' }] },
    });
    const sent: string[] = [];
    const run = await runWeeklyReviewJob({
      store,
      now: () => NOW,
      sendEmail: (subject) => {
        sent.push(subject);
        return Promise.resolve();
      },
    });
    expect(run.status).toBe('ok');
    expect(sent).toEqual(['Weekly review, week ending 2026-11-29']);
    const b = log.briefs[0];
    expect(b?.brief.kind).toBe('weekly-review');
    expect(b?.delivery).toEqual({ email: 'sent', push: 'pending', telegram: 'pending' });
    const lines = (h: string) => b?.brief.sections.find((s) => s.heading === h)?.lines;
    expect(lines('Results')?.[0]).toBe('1 trade closed, 1 winning: USD 400.00 realized.');
    expect(lines('Alerts')).toEqual(['1 alert: 1 push.', 'Feedback: 1 noise.']);
    // Nothing ticked: 1 named setup of 10 items.
    expect(lines('Behavior')?.[0]).toBe('Mean adherence 10 over 1 trade.');
  });
});
