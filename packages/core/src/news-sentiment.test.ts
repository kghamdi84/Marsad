import { describe, expect, it } from 'vitest';
import {
  MIN_LABELLED,
  NEWS_SENTIMENT_VERSION,
  labelFor,
  newsSentiment,
  type LabelledArticle,
} from './news-sentiment.js';
import type { DailyBar } from './study.js';

const a = (publishedAt: string, label: LabelledArticle['label']): LabelledArticle => ({
  publishedAt,
  label,
});
const bar = (date: string, close: number): DailyBar => ({
  date,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
  vwap: null,
});
// Saturday 28 Nov 2026, 10:00 ET: this week started Monday 23 Nov.
const NOW = new Date('2026-11-28T15:00:00Z');
const ARTICLES = [
  a('2026-11-24T14:00:00Z', 'positive'),
  a('2026-11-25T14:00:00Z', 'positive'),
  a('2026-11-27T14:00:00Z', 'negative'),
  // 03:00 UTC on Monday 23 Nov is 22:00 ET on Sunday 22 Nov: last week.
  a('2026-11-23T03:00:00Z', 'neutral'),
  a('2026-11-17T14:00:00Z', null),
  a('2026-11-10T14:00:00Z', 'positive'),
  a('2026-11-11T14:00:00Z', 'positive'),
  a('2026-11-12T14:00:00Z', 'negative'),
  a('2026-11-13T14:00:00Z', 'neutral'),
];

describe('news-sentiment-1', () => {
  it('counts this week, the weekly average and the 12-week coverage by hand', () => {
    const s = newsSentiment({
      articles: ARTICLES,
      others: [],
      bars: [bar('2026-11-20', 100), bar('2026-11-27', 110)],
      now: NOW,
      weeks: 4,
    });
    expect(s.formulaVersion).toBe(NEWS_SENTIMENT_VERSION);
    expect(s.weekStart).toBe('2026-11-23');
    // Stored weeks start with the oldest article's week (9 Nov): 9 Nov had 4, 16 Nov had 2, so 3 a week.
    expect(s.buzz).toEqual({ thisWeek: 3, averagePerWeek: 3, storedWeeks: 2 });
    // 3 labelled this week, under 30: counts only, no percentage.
    expect(s.sentiment).toEqual({
      positive: 2,
      neutral: 0,
      negative: 1,
      labelled: 3,
      positivePct: null,
    });
    expect(s.coverage.map((w) => [w.start, w.total, w.unlabelled, w.close])).toEqual([
      ['2026-11-02', 0, 0, null],
      ['2026-11-09', 4, 0, null],
      ['2026-11-16', 2, 1, 100],
      ['2026-11-23', 3, 0, 110],
    ]);
  });

  it("gives a share for Marsad's stored tickers only from 30 labelled articles", () => {
    const others = Array.from({ length: MIN_LABELLED }, (_, i) => ({
      ticker: i % 2 ? 'AAPL' : 'MSFT',
      publishedAt: '2026-11-24T15:00:00Z',
      label: (i < 12 ? 'positive' : 'neutral') as 'positive' | 'neutral',
    }));
    const s = newsSentiment({ articles: [], others, bars: [], now: NOW });
    expect(s.others).toMatchObject({ labelled: 30, positive: 12, positivePct: 40, tickers: 2 });
    const few = newsSentiment({ articles: [], others: others.slice(1), bars: [], now: NOW });
    expect(few.others.positivePct).toBeNull();
    expect(s.buzz).toEqual({ thisWeek: 0, averagePerWeek: null, storedWeeks: 0 });
    expect(s.coverage).toHaveLength(12);
  });

  it('reads the label for the ticker in question only', () => {
    const list = [
      { ticker: 'AMD', label: 'negative' },
      { ticker: 'NVDA', label: 'positive' },
    ];
    expect(labelFor(list, 'NVDA')).toBe('positive');
    expect(labelFor(list, 'INTC')).toBeNull();
    expect(labelFor([{ ticker: 'NVDA', label: 'mixed' }], 'NVDA')).toBeNull();
    expect(labelFor(null, 'NVDA')).toBeNull();
  });
});
