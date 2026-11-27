import { describe, expect, it } from 'vitest';
import { IMPACT_VERSION, newsImpact, rankByImpact, type ImpactContext } from './news-impact.js';

// Hand-checked against the point table in news-impact.ts. Scores are whole numbers, so they are compared exactly
// (tolerance 0).
const ctx: ImpactContext = {
  watchlist: ['NVDA', 'AVGO', 'AAPL', 'TSLA'],
  holdings: ['NVDA', 'TSLA'],
  topicRatios: { sanctions: 1.7, centralBanks: 2.4, energy: null, tariffs: 0.9 },
};

describe('newsImpact (impact-1), hand-checked', () => {
  it('a Tier 1 8-K with a high-materiality item about a holding is high: 3 + 3 + 3 + 0 = 9', () => {
    const r = newsImpact(
      {
        tier: 1,
        filing: { form: '8-K', materiality: 'high' },
        tickers: ['TSLA'],
        title: 'TSLA files 8-K, item 5.02: executive departure',
      },
      ctx,
    );
    expect(r).toEqual({
      version: IMPACT_VERSION,
      score: 9,
      level: 'high',
      points: { tier: 3, filing: 3, match: 3, topic: 0 },
      held: ['TSLA'],
      watched: [],
      topic: null,
    });
  });

  it('a Tier 1 8-K with only a low item about a watchlist name is medium: 3 + 0 + 2 = 5', () => {
    const r = newsImpact(
      {
        tier: 1,
        filing: { form: '8-K', materiality: 'low' },
        tickers: ['AVGO'],
        title: 'AVGO files 8-K, item 8.01: other event',
      },
      ctx,
    );
    expect(r.score).toBe(5);
    expect(r.level).toBe('medium');
    expect(r.watched).toEqual(['AVGO']);
  });

  it('an amended 10-Q counts as a 10-Q (2), and an unknown 8-K item as 1', () => {
    expect(
      newsImpact(
        { tier: 1, filing: { form: '10-Q/A', materiality: 'unknown' }, tickers: [], title: 'x' },
        ctx,
      ).points.filing,
    ).toBe(2);
    expect(
      newsImpact(
        { tier: 1, filing: { form: '8-K', materiality: 'unknown' }, tickers: [], title: 'x' },
        ctx,
      ).points.filing,
    ).toBe(1);
    expect(
      newsImpact(
        { tier: 1, filing: { form: 'SC 13D', materiality: 'unknown' }, tickers: [], title: 'x' },
        ctx,
      ).points.filing,
    ).toBe(1);
  });

  it('a Tier 2 wire on export controls naming a holding and a watchlist name: 2 + 0 + 3 + 1 = 6', () => {
    // "export controls" is a sanctions headline; sanctions run at 1.7 times the norm (1.5 or more scores 1).
    const r = newsImpact(
      {
        tier: 2,
        tickers: ['NVDA', 'AVGO', 'NVDA'],
        title: 'US widens its review of AI chip export controls to more Gulf buyers',
      },
      ctx,
    );
    expect(r.points).toEqual({ tier: 2, filing: 0, match: 3, topic: 1 });
    expect(r.score).toBe(6);
    expect(r.level).toBe('medium');
    expect(r.held).toEqual(['NVDA']);
    expect(r.watched).toEqual(['AVGO']);
    expect(r.topic).toEqual({ topic: 'sanctions', ratio: 1.7 });
  });

  it('takes the highest topic ratio of the headline: central banks at 2.4 scores 2', () => {
    const r = newsImpact(
      { tier: 2, tickers: [], title: 'Fed minutes show officials split as oil prices slide' },
      ctx,
    );
    // Central banks 2.4 (scores 2); energy has no norm (null) and is skipped.
    expect(r.topic).toEqual({ topic: 'centralBanks', ratio: 2.4 });
    expect(r.score).toBe(4);
    expect(r.level).toBe('low');
  });

  it('a topic under 1.5 times the norm scores nothing and is not reported', () => {
    const r = newsImpact({ tier: 2, tickers: [], title: 'New tariffs on steel' }, ctx);
    expect(r.points.topic).toBe(0);
    expect(r.topic).toBeNull();
  });

  it('an opinion piece loses a point, never below zero', () => {
    expect(newsImpact({ tier: 3, opinion: true, tickers: ['AAPL'], title: 'x' }, ctx).score).toBe(
      2,
    );
    expect(newsImpact({ tier: 4, opinion: true, tickers: [], title: 'x' }, ctx).score).toBe(0);
  });

  it('thresholds: 8 is high, 7 is medium, 5 is medium, 4 is low', () => {
    const at = (tier: 1 | 2, materiality: 'high' | 'medium', tickers: string[]) =>
      newsImpact({ tier, filing: { form: '8-K', materiality }, tickers, title: 'x' }, ctx).level;
    expect(at(1, 'medium', ['NVDA'])).toBe('high'); // 3 + 2 + 3 = 8
    expect(at(1, 'medium', ['AVGO'])).toBe('medium'); // 3 + 2 + 2 = 7
    expect(newsImpact({ tier: 2, tickers: ['TSLA'], title: 'x' }, ctx).level).toBe('medium'); // 5
    expect(newsImpact({ tier: 2, tickers: ['AAPL'], title: 'x' }, ctx).level).toBe('low'); // 4
  });
});

describe('rankByImpact', () => {
  it('orders by score, then newer first, then id', () => {
    const imp = (score: number) => ({
      ...newsImpact({ tier: 4, tickers: [], title: 'x' }, ctx),
      score,
    });
    const items = [
      { id: 'b', at: '2026-11-25T14:00:00Z', impact: imp(5) },
      { id: 'a', at: '2026-11-25T14:00:00Z', impact: imp(5) },
      { id: 'c', at: '2026-11-25T15:00:00Z', impact: imp(5) },
      { id: 'd', at: '2026-11-24T10:00:00Z', impact: imp(9) },
    ];
    expect(rankByImpact(items).map((x) => x.id)).toEqual(['d', 'c', 'a', 'b']);
    // The input is not changed.
    expect(items.map((x) => x.id)).toEqual(['b', 'a', 'c', 'd']);
  });
});
