import { describe, expect, it } from 'vitest';
import synthetic from '../../fixtures/feargreed/synthetic-feargreed.json';
import hy from '../../fixtures/fred/fredgraph-BAMLH0A0HYM2.json';
import ig from '../../fixtures/fred/fredgraph-BAMLC0A0CM.json';
import sp from '../../fixtures/fred/fredgraph-SP500.json';
import vix from '../../fixtures/fred/fredgraph-VIXCLS.json';
import type { FredObservation } from '@marsad/core';
import { fakeStore } from './fake-store.js';
import { runSentimentJob } from './sentiment-job.js';
import type { DailyClose, SentimentBreadthRow } from './store.js';

function rows(text: string): FredObservation[] {
  return text
    .trim()
    .split('\n')
    .slice(1)
    .map((l) => l.split(','))
    .map(([d, v]) => ({
      date: d as string,
      value: v === undefined || v === '' || v === '.' ? null : Number(v),
    }));
}
const bars = (p: [string, number][]): DailyClose[] =>
  p.map(([date, close]) => ({ date, low: close, close }));

const fred = {
  SP500: rows(sp.body),
  VIXCLS: rows(vix.body),
  BAMLH0A0HYM2: rows(hy.body),
  BAMLC0A0CM: rows(ig.body),
};

describe('runSentimentJob on real FRED series and the synthetic market', () => {
  it('stores the composite the independent implementation computed, for every day', async () => {
    const { store, log } = fakeStore({
      fred,
      breadthInputs: synthetic.breadth as SentimentBreadthRow[],
      dailyCloses: {
        SPY: bars(synthetic.spy as [string, number][]),
        IEF: bars(synthetic.ief as [string, number][]),
      },
      recessionLevels: [],
    });
    const run = await runSentimentJob({ store, now: () => new Date('2026-11-25T11:00:00Z') });
    expect(run.status).toBe('ok');
    const days = log.fearGreed[0] ?? [];
    const expected = synthetic.expected as [string, number | null, number][];
    expect(days).toHaveLength(expected.length);
    const last = expected.at(-1) as [string, number, number];
    expect(days.at(-1)?.date).toBe(last[0]);
    expect(days.at(-1)?.composite).toBeCloseTo(last[1], 8);
    expect(run.details).toMatchObject({
      latest: '2026-11-23',
      composite: Math.round(last[1]),
      available: 5,
      versions: ['fear-greed-1', 'capitulation-1'],
    });
    // No recession levels stored: no day can be "on", and none is reported "off" for lack of data alone.
    const cap = log.capitulation[0] ?? [];
    expect(cap).toHaveLength(days.length);
    expect(cap.some((d) => d.state === 'on')).toBe(false);
    expect(log.runs[0]?.job).toBe('sentiment-daily');
  });

  it('fails loudly when the newest composite is more than 5 days old', async () => {
    const { store } = fakeStore({
      fred,
      breadthInputs: synthetic.breadth as SentimentBreadthRow[],
      dailyCloses: {
        SPY: bars(synthetic.spy as [string, number][]),
        IEF: bars(synthetic.ief as [string, number][]),
      },
    });
    const run = await runSentimentJob({ store, now: () => new Date('2026-12-05T11:00:00Z') });
    expect(run.status).toBe('error');
    expect(run.error).toContain('2026-11-23');
  });

  it('says why when no day has 4 components yet', async () => {
    const { store } = fakeStore({ fred: { SP500: fred.SP500 } });
    const run = await runSentimentJob({ store, now: () => new Date('2026-11-25T11:00:00Z') });
    expect(run.status).toBe('error');
    expect(run.error).toContain('No day has 4 of 7 components');
  });
});

/** Weekdays from 2025-01-01. */
function weekdays(n: number): string[] {
  const out: string[] = [];
  for (let t = Date.UTC(2025, 0, 1); out.length < n; t += 86_400_000) {
    const w = new Date(t).getUTCDay();
    if (w !== 0 && w !== 6) out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

describe('runSentimentJob on a market that capitulates on its last days', () => {
  // 400 calm sessions, then a 5-session crash: every component's last values are the most fearful in its window.
  const dates = weekdays(405);
  const crash = (i: number) => i >= 400;
  const obs = (f: (i: number) => number) =>
    dates.map((date, i) => ({ date, value: f(i) }) as FredObservation);
  const seed = {
    fred: {
      SP500: obs((i) => (crash(i) ? 5000 - (i - 399) * 250 : 4000 + i * 2.5)),
      VIXCLS: obs((i) => (crash(i) ? 36 + (i - 400) : 14 + (i % 7) * 0.1)),
      BAMLH0A0HYM2: obs((i) => (crash(i) ? 6 + (i - 400) * 0.2 : 3 + (i % 5) * 0.01)),
      BAMLC0A0CM: obs(() => 1),
    },
    breadthInputs: dates.map((date, i) => ({
      date,
      newHighs: 10,
      newLows: 10,
      n252: 0,
      mcclellanSummation: crash(i) ? -500 - (i - 400) * 100 : 100 + (i % 9),
      above50: crash(i) ? 60 : 600,
      n50: 1000,
    })),
    dailyCloses: {
      SPY: dates.map((date, i) => {
        const close = crash(i) ? 500 - (i - 399) * 25 : 400 + i * 0.25;
        return { date, low: close, close };
      }),
      IEF: dates.map((date) => ({ date, low: 95, close: 95 })),
    },
    recessionLevels: dates.map((date) => ({ date, level: 'low' })),
  };

  it('turns the watch on, with every condition and a stored staged plan', async () => {
    const { store, log } = fakeStore(seed);
    const run = await runSentimentJob({ store, now: () => new Date('2026-07-23T11:00:00Z') });
    const last = (log.fearGreed[0] ?? []).at(-1);
    expect(last?.available).toBe(5); // momentum, breadth, junk, volatility, safe haven
    expect(last?.composite).toBeLessThanOrEqual(15);
    const cap = log.capitulation[0] ?? [];
    const on = cap.filter((d) => d.state === 'on').map((d) => d.date);
    expect(on.length).toBeGreaterThan(0);
    expect(cap.at(-1)?.state).toBe('on');
    expect(cap.at(-1)?.conditions.map((c) => c.met)).toEqual([true, true, true, true]);
    const plans = log.plans[0] ?? [];
    expect(plans).toHaveLength(1);
    expect(plans[0]?.triggerDate).toBe(on[0]);
    expect(plans[0]?.tranches[0]).toMatchObject({ status: 'met' });
    expect(run.details).toMatchObject({ episodes: 1 });
    expect(String((run.details as Record<string, unknown>)['capitulation'])).toContain('on');
  });

  it('raises one regime alert for a fresh trigger, quoting the stored event study with n', async () => {
    const { store, log } = fakeStore(seed);
    // The crash starts on 2026-07-15 (the trigger); the job runs the next day at 15:00 in Riyadh (outside quiet hours).
    const run = await runSentimentJob({ store, now: () => new Date('2026-07-16T12:00:00Z') });
    const trigger = (log.plans[0] ?? [])[0]?.triggerDate;
    expect(trigger).toBe('2026-07-15');
    const rows = log.storedAlerts.flat();
    expect(rows).toHaveLength(1);
    const a = rows[0];
    expect(a?.input).toMatchObject({
      kind: 'regime',
      priority: 'high',
      ruleId: 'capitulation-watch',
      ruleStatus: 'live',
      eventId: `capitulation:${trigger}`,
      headline: 'Capitulation watch ON',
      delayed: true,
    });
    expect(a?.decision).toBe('push');
    expect(a?.delivery['push']).toBe('pending');
    expect(a?.input.trigger).toContain(`Trigger at the close of ${trigger}: VIX `);
    expect(a?.input.trigger).toContain('Marsad event study: not computed yet.');
    expect(a?.input.risk.at(-1)).toEqual({ horizon: 'long', losses: 0, n: 0 });
    expect(run.details).toMatchObject({ capitulationAlert: { push: 1 } });
  });

  it('says insufficient history under 30 episodes and counts losses at 63 sessions', async () => {
    // Two proxy episodes in the calm stretch, where 63 sessions later the S&P 500 is higher: 0 losses of 2.
    const { store, log } = fakeStore({
      ...seed,
      latestRows: {
        'regime_event_stats|condition=vix-30-recession-not-high': [
          {
            horizon: 63,
            n: 9,
            median: 0.05,
            q1: -0.02,
            q3: 0.1,
            data_from: '2016-01-04',
            episodes: [dates[10], dates[100]],
          },
        ],
      },
    });
    await runSentimentJob({ store, now: () => new Date('2026-07-16T23:00:00Z') });
    const a = log.storedAlerts.flat()[0];
    expect(a?.input.trigger).toContain(
      'S&P 500 since 2016-01-04): n=9 episodes, insufficient history for a rate.',
    );
    expect(a?.input.risk.at(-1)).toEqual({ horizon: 'long', losses: 0, n: 2 });
  });

  it('never alerts on an old trigger', async () => {
    // Still on, but the trigger (2026-07-15) is 6 days old: history, not news.
    const { store, log } = fakeStore(seed);
    const run = await runSentimentJob({ store, now: () => new Date('2026-07-21T23:00:00Z') });
    expect(String((run.details as Record<string, unknown>)['capitulation'])).toBe(
      'on on 2026-07-21',
    );
    expect(run.status).toBe('ok');
    expect(log.storedAlerts.flat()).toHaveLength(0);
  });

  it('a later run does not store the same trigger again', async () => {
    const first = fakeStore(seed);
    await runSentimentJob({ store: first.store, now: () => new Date('2026-07-16T23:00:00Z') });
    const key = first.log.storedAlerts.flat()[0]?.key as string;
    const again = fakeStore({
      ...seed,
      recentAlerts: [{ key, at: '2026-07-16T23:00:00Z', decision: 'push' }],
    });
    await runSentimentJob({ store: again.store, now: () => new Date('2026-07-17T23:00:00Z') });
    expect(key).toBeTruthy();
    expect(again.log.storedAlerts.flat()).toHaveLength(0);
  });

  it('stays off when the recession filter is high', async () => {
    const { store, log } = fakeStore({
      ...seed,
      recessionLevels: dates.map((date) => ({ date, level: 'high' })),
    });
    await runSentimentJob({ store, now: () => new Date('2026-07-23T11:00:00Z') });
    expect((log.capitulation[0] ?? []).some((d) => d.state === 'on')).toBe(false);
    expect(log.plans[0]).toEqual([]);
    expect(log.storedAlerts.flat()).toHaveLength(0);
  });
});
