import { describe, expect, it } from 'vitest';
import { buildEventMarkers, type InsiderBuyEvent } from './study.js';

// Mon 2026-11-16 to Fri 2026-11-20.
const DATES = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'];

const buy = (filedAt: string, owner: string, valueUsd: number, plan10b5: boolean | null = false) =>
  ({ filedAt, owner, valueUsd, plan10b5 }) satisfies InsiderBuyEvent;

describe('buildEventMarkers: insider buys, halts and alerts', () => {
  it('places an insider purchase on the session its Form 4 became public, not the trade date', () => {
    // Filed Tuesday 17:30 ET (22:30 UTC), after the close: nobody could trade on it until Wednesday.
    const m = buildEventMarkers([], [], DATES, [], {
      insiderBuys: [buy('2026-11-17T22:30:00Z', 'Jane Doe', 250_000)],
    });
    expect(m).toEqual([
      {
        date: '2026-11-18',
        kind: 'insider-buy',
        label: 'Insider buy: 1 owner, $250,000',
        materiality: null,
      },
    ]);
  });

  it('groups purchases public on the same session: owners counted once, values summed', () => {
    const m = buildEventMarkers([], [], DATES, [], {
      insiderBuys: [
        buy('2026-11-19T14:00:00Z', 'Jane Doe', 100_000), // 09:00 ET Thursday
        buy('2026-11-19T15:00:00Z', 'Jane Doe', 50_000.4),
        buy('2026-11-19T18:00:00Z', 'John Roe', 1_000_000),
      ],
    });
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({
      date: '2026-11-19',
      label: 'Insider buy: 2 owners, $1,150,000',
    });
  });

  it('labels a session whose purchases were all under a 10b5-1 plan', () => {
    const m = buildEventMarkers([], [], DATES, [], {
      insiderBuys: [buy('2026-11-16T15:00:00Z', 'Jane Doe', 10_000, true)],
    });
    expect(m[0]?.label).toBe('Insider buy: 1 owner, $10,000 (10b5-1 plan)');
  });

  it('a halt sits on the session it happened; an alert after the close on the next session', () => {
    const m = buildEventMarkers([], [], DATES, [], {
      halts: [{ haltedAt: '2026-11-17T19:32:05Z', reason: 'T1 (News pending)' }], // 14:32 ET
      alerts: [{ createdAt: '2026-11-18T22:40:00Z', headline: 'RKLB closed at or below its stop' }], // 17:40 ET
    });
    expect(m.map((x) => [x.date, x.kind, x.label])).toEqual([
      ['2026-11-17', 'halt', 'Halt: T1 (News pending)'],
      ['2026-11-19', 'alert', 'Alert: RKLB closed at or below its stop'],
    ]);
  });

  it('drops events outside the bars shown', () => {
    const m = buildEventMarkers([], [], DATES, [], {
      halts: [{ haltedAt: '2026-10-01T15:00:00Z', reason: 'LUDP' }],
      alerts: [{ createdAt: '2026-12-01T15:00:00Z', headline: 'later' }],
    });
    expect(m).toEqual([]);
  });
});

describe('buildEventMarkers: results 8-Ks', () => {
  const eightK = (acceptedAt: string, items: string[]) => ({
    form: '8-K',
    filingDate: acceptedAt.slice(0, 10),
    acceptedAt,
    items,
  });
  it('flags an 8-K carrying Item 2.02 as results, and no other', () => {
    const m = buildEventMarkers(
      [
        // Wednesday 16:20 ET, after the close: the results react on Thursday.
        eightK('2026-11-18T21:20:00Z', ['2.02', '9.01']),
        // Monday 10:00 ET: a material agreement, an ordinary F marker.
        eightK('2026-11-16T15:00:00Z', ['1.01']),
      ],
      [],
      DATES,
    );
    expect(m).toEqual([
      {
        date: '2026-11-16',
        kind: 'medium-8k',
        label: '8-K: Signed a major agreement',
        materiality: 'medium',
      },
      {
        date: '2026-11-19',
        kind: 'high-8k',
        label: '8-K: Earnings results released',
        materiality: 'high',
        results: true,
      },
    ]);
  });
});
