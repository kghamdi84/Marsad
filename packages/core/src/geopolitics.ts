/**
 * Geopolitical topic counts (ADR 0012, `topics-1`): documented keyword rules sort each article into the brief's six
 * topics; code counts them per UTC day and compares the last 7 days with the 4 weeks before. Pure.
 */

export const TOPICS_VERSION = 'topics-1';

export type Topic = 'conflict' | 'sanctions' | 'tariffs' | 'elections' | 'centralBanks' | 'energy';

export const TOPICS: readonly Topic[] = [
  'conflict',
  'sanctions',
  'tariffs',
  'elections',
  'centralBanks',
  'energy',
];

/** Figurative "wars" that are not armed conflict; removed before the conflict rule runs. */
const NOT_CONFLICT =
  /\b(?:trade|price|pricing|talent|streaming|bidding|console|chip|tariff|currency|culture|turf|patent|bargain|subscriber)\s+wars?\b/gi;

/** Case-insensitive, whole words. An article can match several topics; it counts once per topic. */
export const TOPIC_RULES: Readonly<Record<Topic, RegExp>> = Object.freeze({
  conflict:
    /\b(?:wars?|warfare|military|militaries|missiles?|air ?strikes?|invasion|invaded|invades|troops|cease-?fires?|armed conflict|shelling|drone strikes?|blockade|nato|hostilities)\b/i,
  sanctions:
    /\b(?:sanctions?|sanctioned|embargo(?:es)?|export controls?|export bans?|entity list|blacklist(?:ed)?|asset freezes?)\b/i,
  tariffs:
    /\b(?:tariffs?|trade wars?|import dut(?:y|ies)|customs dut(?:y|ies)|trade deals?|trade talks|trade tensions?|section 301|section 232|anti-?dumping|countervailing)\b/i,
  elections:
    /\b(?:elections?|electoral|ballots?|midterms?|referendum|voters|runoff|presidential race|polling stations?|exit polls?)\b/i,
  centralBanks:
    /\b(?:federal reserve|the fed|fed (?:chair|governors?|meeting|decision|officials?|minutes|rate)|fomc|rate (?:cuts?|hikes?|pause)|central banks?|ecb|bank of england|bank of japan|boj|pboc|monetary policy)\b/i,
  energy:
    /(?:\bopec\b\+?|\b(?:crude|oil prices?|price of oil|brent|wti|natural gas|lng|oil output|oil production|oil supply|refiner(?:y|ies)|gasoline prices?|energy prices?|barrels? (?:a|per) day)\b)/i,
});

/** The topics an article's text matches. */
export function topicsOf(text: string): Topic[] {
  return TOPICS.filter((t) => {
    const s = t === 'conflict' ? text.replace(NOT_CONFLICT, ' ') : text;
    return TOPIC_RULES[t].test(s);
  });
}

export interface TopicArticle {
  title: string;
  description: string | null;
  publisher: string;
  url: string;
  publishedAt: string;
}

export interface TopicSample {
  title: string;
  publisher: string;
  url: string;
  publishedAt: string;
}

export interface TopicDay {
  date: string;
  version: string;
  total: number;
  counts: Record<Topic, number>;
  /** Up to 3 newest headlines per topic. */
  samples: Record<Topic, TopicSample[]>;
}

const empty = <T>(f: () => T): Record<Topic, T> =>
  Object.fromEntries(TOPICS.map((t) => [t, f()])) as Record<Topic, T>;

/** Counts one UTC day of articles. Duplicate ids are the caller's job; titles alone are matched with descriptions. */
export function topicDay(date: string, articles: readonly TopicArticle[]): TopicDay {
  const counts = empty(() => 0);
  const samples = empty<TopicSample[]>(() => []);
  const newestFirst = [...articles].sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
  for (const a of newestFirst) {
    for (const t of topicsOf(`${a.title}. ${a.description ?? ''}`)) {
      counts[t] += 1;
      if (samples[t].length < 3)
        samples[t].push({
          title: a.title,
          publisher: a.publisher,
          url: a.url,
          publishedAt: a.publishedAt,
        });
    }
  }
  return { date, version: TOPICS_VERSION, total: articles.length, counts, samples };
}

export interface TopicReading {
  topic: Topic;
  /** Articles in the last 7 days. */
  last7: number;
  /** Their share of all articles in those days, 0 to 1; null with no articles. */
  share7: number | null;
  /** Weekly average over the 28 days before, scaled from the days stored; null with none stored. */
  weeklyBaseline: number | null;
  /** last7 over the baseline; null when the baseline is zero or missing. */
  ratio: number | null;
}

export interface TopicSummary {
  version: string;
  asOf: string;
  /** Days with data in the last 7 and in the 28 before. */
  recentDays: number;
  baselineDays: number;
  readings: TopicReading[];
}

const shift = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** The last 7 days ending on `asOf` against the 28 days before them, from stored days (any order). */
export function topicSummary(days: readonly TopicDay[], asOf: string): TopicSummary {
  const recentFrom = shift(asOf, -6);
  const baseFrom = shift(asOf, -34);
  const recent = days.filter((d) => d.date >= recentFrom && d.date <= asOf);
  const base = days.filter((d) => d.date >= baseFrom && d.date < recentFrom);
  const total7 = recent.reduce((s, d) => s + d.total, 0);
  return {
    version: TOPICS_VERSION,
    asOf,
    recentDays: recent.length,
    baselineDays: base.length,
    readings: TOPICS.map((topic) => {
      const last7 = recent.reduce((s, d) => s + d.counts[topic], 0);
      const baseSum = base.reduce((s, d) => s + d.counts[topic], 0);
      const weeklyBaseline = base.length === 0 ? null : (baseSum * 7) / base.length;
      return {
        topic,
        last7,
        share7: total7 === 0 ? null : last7 / total7,
        weeklyBaseline,
        ratio: weeklyBaseline === null || weeklyBaseline === 0 ? null : last7 / weeklyBaseline,
      };
    }),
  };
}
