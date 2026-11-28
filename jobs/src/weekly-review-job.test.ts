import { describe, expect, it } from 'vitest';
import type { MessageParams } from './anthropic.js';
import { factId, fakeAiStore, fakeClient, json, type FakeReply } from './ai-fakes.js';
import { fakeStore } from './fake-store.js';
import { runWeeklyReviewJob } from './weekly-review-job.js';

const NOW = new Date('2026-11-29T07:30:00Z'); // Sunday: the week is 2026-11-23 to 2026-11-29

function weekStore() {
  return fakeStore({
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
}

describe('runWeeklyReviewJob', () => {
  it('stores the review as a brief with its inputs and emails it when configured', async () => {
    const { store, log } = weekStore();
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

describe('weekly review prose (Claude Opus 5.5, checklist 7.8; fake client, never the real API)', () => {
  const prose = (p: MessageParams) =>
    json(
      `You closed 1 trade this week and it made money [${factId(p, 'Week ending')}, ${factId(p, 'Closed trades that made money')}]. The realized result was $400.00 [${factId(p, 'Realized result')}]. The mean result was 2R [${factId(p, 'Mean result in R')}]. Mean adherence was 10, so most of the plan was not followed [${factId(p, 'Mean plan adherence')}].`,
    );

  async function go(replies: (FakeReply | ((p: MessageParams) => FakeReply))[], key = true) {
    const { store, log } = weekStore();
    const ai = fakeAiStore();
    const client = fakeClient(replies);
    const emails: string[] = [];
    const run = await runWeeklyReviewJob({
      store,
      now: () => NOW,
      sendEmail: (_s, text) => {
        emails.push(text);
        return Promise.resolve();
      },
      ai: { client: key ? client : null, store: ai.store },
    });
    return { run, log, ai, client, emails };
  }

  it('without the key: the template review only, AI skipped (not configured), nothing spent', async () => {
    const { run, ai, log, emails } = await go([], false);
    expect(run.status).toBe('ok');
    expect(run.details['ai']).toEqual({
      status: 'skipped: not configured (ANTHROPIC_API_KEY secret missing)',
    });
    expect(ai.outputs).toEqual([]);
    expect(ai.usage).toEqual([]);
    expect(log.briefs).toHaveLength(1);
    expect(emails[0]).not.toContain('AI-written');
  });

  it('verified prose is stored for the week and added to the email under its label, template kept', async () => {
    const { run, ai, client, emails, log } = await go([(p) => ({ text: prose(p) })]);
    const req = client.requests[0]!;
    expect(req.model).toBe('claude-opus-5-5');
    expect(req.output_config?.effort).toBe('medium');
    expect(req.thinking).toEqual({ type: 'adaptive' });
    expect(ai.outputs[0]).toMatchObject({
      kind: 'weekly-review',
      ticker: null,
      for_date: '2026-11-29',
      prompt_id: 'weekly-review',
      model: 'claude-opus-5-5',
      source: 'model',
      verified: true,
    });
    expect(run.details['ai']).toMatchObject({ status: 'verified', calls: 1 });
    expect(emails[0]).toContain('Results');
    expect(emails[0]).toContain(
      'AI-written from the figures above (Claude Opus 5.5, every number checked)\nYou closed 1 trade',
    );
    // The template brief is stored as before.
    expect(log.briefs[0]?.brief.kind).toBe('weekly-review');
  });

  it('a wrong number twice: the template stays alone and the attempt is stored for audit', async () => {
    const wrong = (p: MessageParams) => ({
      text: json(`The realized result was $450.00 [${factId(p, 'Realized result')}].`),
    });
    const { ai, emails, run } = await go([wrong, wrong]);
    expect(ai.outputs[0]).toMatchObject({
      source: 'template',
      fallback_reason: 'verification-failed',
    });
    expect(run.details['ai']).toMatchObject({ status: 'template (verification-failed)' });
    expect(emails[0]).not.toContain('AI-written');
  });

  it('a refusal leaves the template review alone, and the run still succeeds', async () => {
    const refused = await go([{ stop: 'refusal' }]);
    expect(refused.run.status).toBe('ok');
    expect(refused.run.details['ai']).toMatchObject({ status: 'template (refusal)' });
  });
});
