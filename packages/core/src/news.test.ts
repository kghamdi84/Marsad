import { describe, expect, it } from 'vitest';
import {
  classifyPublisher,
  clusterNews,
  headlineSimilarity,
  headlineTokens,
  normalizePublisher,
  type NewsItem,
} from './news.js';

const item = (
  id: string,
  publisher: string,
  title: string,
  publishedAt: string,
  tickers: string[] = ['NVDA'],
): NewsItem => ({ id, publisher, title, publishedAt, url: `https://example.com/${id}`, tickers });

describe('publisher tiers (publishers seen in Massive news on 2026-11-24)', () => {
  it('puts analysis sites in tier 3 and labels them opinion', () => {
    expect(classifyPublisher('The Motley Fool')).toEqual({ tier: 3, opinion: true, known: true });
    expect(classifyPublisher('Zacks Investment Research')).toMatchObject({
      tier: 3,
      opinion: true,
    });
  });
  it('puts a distribution wire in tier 2, because it carries any customer’s release', () => {
    expect(classifyPublisher('GlobeNewswire Inc.')).toEqual({
      tier: 2,
      opinion: false,
      known: true,
    });
  });
  it('never assumes an unknown publisher is reputable', () => {
    expect(classifyPublisher('Totally Real Stock Tips')).toEqual({
      tier: 4,
      opinion: true,
      known: false,
    });
  });
  it('honours a custom table', () => {
    expect(
      classifyPublisher('Totally Real Stock Tips', {
        'totally real stock tips': { tier: 3, opinion: false },
      }),
    ).toMatchObject({ tier: 3, known: true });
  });
  it('normalizes names', () => {
    expect(normalizePublisher('The Motley Fool')).toBe('motley fool');
    expect(normalizePublisher('GlobeNewswire Inc.')).toBe('globenewswire');
    expect(normalizePublisher("Investor's Business Daily")).toBe('investor s business daily');
  });
});

describe('headline comparison', () => {
  it('drops filler words and punctuation', () => {
    expect(
      [...headlineTokens('Is the Stock Market in the Early Stages of a Crash?')].sort(),
    ).toEqual(['crash', 'early', 'market', 'stages', 'stock']);
  });
  it('is Jaccard similarity: shared words over all words (hand-checked 3 of 5 = 0.6)', () => {
    const a = new Set(['a1', 'b1', 'c1', 'd1']);
    const b = new Set(['a1', 'b1', 'c1', 'e1']);
    expect(headlineSimilarity(a, b)).toBe(3 / 5);
    expect(headlineSimilarity(new Set(), new Set())).toBe(0);
  });
});

describe('clusterNews: one story from many outlets counts once', () => {
  const reuters = item(
    'r1',
    'Reuters',
    'Nvidia CEO Jensen Huang reinstated after board vote',
    '2026-11-24T14:00:00Z',
  );
  const bloomberg = item(
    'b1',
    'Bloomberg',
    'Nvidia reinstates CEO Jensen Huang after board vote',
    '2026-11-24T14:20:00Z',
  );
  const fool = item(
    'f1',
    'The Motley Fool',
    'Nvidia CEO Jensen Huang reinstated: what investors need to know',
    '2026-11-24T16:00:00Z',
  );
  const other = item(
    'o1',
    'Reuters',
    'Nvidia earnings preview: what to expect',
    '2026-11-24T15:00:00Z',
  );

  it('merges rewrites of one story, keeps the earliest time and the outlets in order', () => {
    const clusters = clusterNews([fool, bloomberg, other, reuters]);
    expect(clusters).toHaveLength(2);
    const story = clusters.find((c) => c.id === 'r1');
    expect(story).toMatchObject({
      earliest: '2026-11-24T14:00:00Z',
      outlets: ['Reuters', 'Bloomberg', 'The Motley Fool'],
      bestTier: 2,
      opinionOnly: false,
    });
    expect(story?.articles.map((a) => a.id)).toEqual(['r1', 'b1', 'f1']);
  });
  it('lists the newest story first', () => {
    expect(clusterNews([reuters, other]).map((c) => c.id)).toEqual(['o1', 'r1']);
  });
  it('marks a story as opinion only when every article is analysis or opinion', () => {
    const zacks = item(
      'z1',
      'Zacks Investment Research',
      'Nvidia CEO Jensen Huang reinstated after board vote',
      '2026-11-24T17:00:00Z',
    );
    const c = clusterNews([fool, zacks]);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ opinionOnly: true, bestTier: 3 });
  });
  it('does not merge the same headline a few days later', () => {
    const later = { ...reuters, id: 'r2', publishedAt: '2026-11-27T14:00:00Z' };
    expect(clusterNews([reuters, later])).toHaveLength(2);
  });
  it('does not merge stories about different companies', () => {
    const amd = { ...bloomberg, id: 'b2', tickers: ['AMD'] };
    expect(clusterNews([reuters, amd])).toHaveLength(2);
  });
  it('does not merge short headlines that share too few words', () => {
    const a = item('s1', 'Reuters', 'Nvidia surges', '2026-11-24T14:00:00Z');
    const b = item('s2', 'Bloomberg', 'Nvidia surges', '2026-11-24T14:05:00Z');
    expect(clusterNews([a, b])).toHaveLength(2);
  });
  it('counts a repeated article id once', () => {
    expect(clusterNews([reuters, reuters])[0]?.articles).toHaveLength(1);
  });
  it('counts one outlet once even if it republishes', () => {
    const again = { ...reuters, id: 'r3', publishedAt: '2026-11-24T14:30:00Z' };
    expect(clusterNews([reuters, again])[0]?.outlets).toEqual(['Reuters']);
  });
  it('returns nothing for no articles', () => {
    expect(clusterNews([])).toEqual([]);
  });
});
