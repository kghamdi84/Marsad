import { describe, expect, it } from 'vitest';
import sample from '../../../fixtures/massive/news-market-sample-2026-11-24.json';
import { parseNewsItems } from './adapters/massive-study.js';
import {
  TOPICS,
  topicDay,
  topicSummary,
  topicsOf,
  type Topic,
  type TopicDay,
} from './geopolitics.js';

describe('topicsOf on 23 real market-wide articles, hand-labelled', () => {
  const articles = parseNewsItems(sample.body.results) ?? [];
  const expected = sample.expectedTopics as Record<string, Topic[]>;

  it('parses every article', () => {
    expect(articles).toHaveLength(23);
  });

  it('matches the hand labels for every article', () => {
    const wrong = articles
      .map((a) => ({
        id: a.id,
        title: a.title,
        got: topicsOf(`${a.title}. ${a.description ?? ''}`),
        want: expected[a.id] ?? [],
      }))
      .filter((x) => JSON.stringify(x.got) !== JSON.stringify(x.want));
    expect(wrong).toEqual([]);
  });

  it('counts the day: 4 tariff, 3 energy, 2 central-bank articles, nothing else (the labels tallied)', () => {
    const d = topicDay(
      '2026-11-24',
      articles.map((a) => ({ ...a })),
    );
    expect(d.total).toBe(23);
    expect(d.counts).toEqual({
      conflict: 0,
      sanctions: 0,
      tariffs: 4,
      elections: 0,
      centralBanks: 2,
      energy: 3,
    });
    // Samples: newest first, at most 3.
    expect(d.samples.tariffs.map((s) => s.publishedAt)).toEqual([
      '2026-11-24T16:44:00.000Z',
      '2026-11-24T15:03:00.000Z',
      '2026-11-24T13:45:03.000Z',
    ]);
  });
});

describe('topic rules on hand-written cases', () => {
  it.each([
    ['Russia launches missile strikes as ceasefire talks stall', ['conflict']],
    ['NATO allies send troops to the border', ['conflict']],
    ['The streaming wars heat up as Netflix raises prices', []],
    ['A price war in memory chips hits margins', []],
    ['Trade war fears return as tariffs rise', ['tariffs']],
    ['EU adds new sanctions on Iranian oil exports; Brent jumps', ['sanctions', 'energy']],
    ['Commerce adds 12 firms to the entity list under new export controls', ['sanctions']],
    ['Voters head to the polls in the midterms', ['elections']],
    ['ECB holds rates; Bank of Japan signals a hike', ['centralBanks']],
    ['FOMC minutes show debate over a rate cut', ['centralBanks']],
    ['OPEC+ agrees to raise output by 400,000 barrels per day', ['energy']],
    ['Fedex earnings beat', []],
    ['Federal Reserve Bank of St. Louis economist speaks', ['centralBanks']],
    ['Software warning lowers guidance', []],
  ] as [string, Topic[]][])('%s', (text, want) => {
    expect(topicsOf(text)).toEqual(want);
  });
});

function day(date: string, total: number, counts: Partial<Record<Topic, number>>): TopicDay {
  return {
    date,
    version: 'topics-1',
    total,
    counts: Object.fromEntries(TOPICS.map((t) => [t, counts[t] ?? 0])) as Record<Topic, number>,
    samples: Object.fromEntries(TOPICS.map((t) => [t, []])) as unknown as TopicDay['samples'],
  };
}

describe('topicSummary', () => {
  it('compares the last 7 days with the weekly average of the 28 before (hand-checked)', () => {
    const days: TopicDay[] = [];
    // 28 baseline days (2026-10-21 .. 2026-11-17) with 2 tariff articles a day: 14 a week.
    for (let i = 0; i < 28; i++) {
      const d = new Date(Date.UTC(2026, 9, 21 + i)).toISOString().slice(0, 10);
      days.push(day(d, 100, { tariffs: 2 }));
    }
    // Last 7 days (2026-11-18 .. 2026-11-24): 6 a day, 42 in total, 42 of 700 articles.
    for (let i = 0; i < 7; i++) {
      const d = new Date(Date.UTC(2026, 10, 18 + i)).toISOString().slice(0, 10);
      days.push(day(d, 100, { tariffs: 6, energy: 1 }));
    }
    const s = topicSummary(days, '2026-11-24');
    expect(s).toMatchObject({ recentDays: 7, baselineDays: 28 });
    const tariffs = s.readings.find((r) => r.topic === 'tariffs');
    expect(tariffs).toEqual({
      topic: 'tariffs',
      last7: 42,
      share7: 0.06,
      weeklyBaseline: 14,
      ratio: 3,
    });
    // Energy had no baseline articles: no ratio (never divide by zero).
    expect(s.readings.find((r) => r.topic === 'energy')).toMatchObject({
      last7: 7,
      weeklyBaseline: 0,
      ratio: null,
    });
  });

  it('scales a partial baseline from the days stored and says how many', () => {
    const days = [day('2026-11-10', 50, { conflict: 3 }), day('2026-11-24', 50, { conflict: 2 })];
    const s = topicSummary(days, '2026-11-24');
    expect(s).toMatchObject({ recentDays: 1, baselineDays: 1 });
    // 3 articles on 1 baseline day is 21 a week.
    expect(s.readings.find((r) => r.topic === 'conflict')).toMatchObject({
      last7: 2,
      weeklyBaseline: 21,
    });
  });

  it('has no baseline with no earlier days', () => {
    const s = topicSummary([day('2026-11-24', 0, {})], '2026-11-24');
    expect(s.readings[0]).toMatchObject({
      last7: 0,
      share7: null,
      weeklyBaseline: null,
      ratio: null,
    });
  });
});
