/**
 * News and sentiment (`news-sentiment-1`) from stored news articles and the news vendor's (Massive) per-ticker
 * sentiment label. The label is the vendor's opinion of the article, not Marsad's view.
 *
 * Weeks run Monday to Sunday in ET. "This week" is the week holding `now`, so far.
 * - Media buzz: articles this week against the average per week over the stored complete weeks before it (from
 *   the week of the oldest loaded article, at most `weeks`).
 * - News sentiment: positive articles over articles with a label this week. A share is given only from 30 or more
 *   labelled articles (rule 10); below that, counts only. The comparison pools this week's labelled articles of
 *   every other ticker Marsad stores news for ("Marsad's stored tickers"), with the same 30 rule.
 * - Media coverage: positive, neutral, negative and unlabelled articles for each of the last `weeks` weeks
 *   (including this one), with the week's last stored close.
 */
import { etDate } from './calendar.js';
import type { DailyBar } from './study.js';

export const NEWS_SENTIMENT_VERSION = 'news-sentiment-1';
export const MIN_LABELLED = 30;

export type SentimentLabel = 'positive' | 'neutral' | 'negative';

export interface LabelledArticle {
  publishedAt: string;
  /** The vendor's label for the ticker in question, or null when the article has none for it. */
  label: SentimentLabel | null;
}

export interface WeekCounts {
  /** Monday, ET. */
  start: string;
  positive: number;
  neutral: number;
  negative: number;
  unlabelled: number;
  total: number;
  /** The last stored close on or before the week's Sunday, within the week; null without a bar that week. */
  close: number | null;
}

export interface Share {
  positive: number;
  neutral: number;
  negative: number;
  labelled: number;
  /** Percent positive; null under MIN_LABELLED labelled articles. */
  positivePct: number | null;
}

export interface NewsSentiment {
  formulaVersion: string;
  weekStart: string;
  buzz: { thisWeek: number; averagePerWeek: number | null; storedWeeks: number };
  sentiment: Share;
  others: Share & { tickers: number };
  coverage: WeekCounts[];
}

const DAY = 86_400_000;
const mondayOf = (d: string) => {
  const t = Date.parse(`${d}T00:00:00Z`);
  return new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);
};
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** The vendor's label for one ticker in an article's sentiment list, or null. */
export function labelFor(
  sentiment: readonly { ticker: string; label: string }[] | null | undefined,
  ticker: string,
): SentimentLabel | null {
  const l = sentiment?.find((s) => s.ticker === ticker)?.label;
  return l === 'positive' || l === 'neutral' || l === 'negative' ? l : null;
}

function share(labels: readonly (SentimentLabel | null)[]): Share {
  const s = { positive: 0, neutral: 0, negative: 0 };
  for (const l of labels) if (l) s[l] += 1;
  const labelled = s.positive + s.neutral + s.negative;
  return {
    ...s,
    labelled,
    positivePct: labelled >= MIN_LABELLED ? (s.positive / labelled) * 100 : null,
  };
}

export function newsSentiment(input: {
  articles: readonly LabelledArticle[];
  /** This week's labels for other tickers' articles: one entry per (article, ticker). */
  others: readonly { ticker: string; publishedAt: string; label: SentimentLabel | null }[];
  bars: readonly DailyBar[];
  now: Date;
  weeks?: number;
}): NewsSentiment {
  const weeks = input.weeks ?? 12;
  const weekStart = mondayOf(etDate(input.now));
  const weekOf = (iso: string) => mondayOf(etDate(new Date(iso)));
  const starts = Array.from({ length: weeks }, (_, i) => addDays(weekStart, -7 * (weeks - 1 - i)));
  const coverage: WeekCounts[] = starts.map((start) => {
    const end = addDays(start, 6);
    const inWeek = input.articles.filter((a) => weekOf(a.publishedAt) === start);
    const s = share(inWeek.map((a) => a.label));
    const close =
      [...input.bars].reverse().find((b) => b.date >= start && b.date <= end)?.close ?? null;
    return {
      start,
      positive: s.positive,
      neutral: s.neutral,
      negative: s.negative,
      unlabelled: inWeek.length - s.labelled,
      total: inWeek.length,
      close,
    };
  });

  const thisWeek = input.articles.filter((a) => weekOf(a.publishedAt) === weekStart);
  const oldest = input.articles.reduce<string | null>(
    (m, a) => (m === null || a.publishedAt < m ? a.publishedAt : m),
    null,
  );
  const firstWeek = oldest ? weekOf(oldest) : weekStart;
  const prior = coverage.filter((w) => w.start < weekStart && w.start >= firstWeek);
  const storedWeeks = prior.length;
  const averagePerWeek =
    storedWeeks === 0 ? null : prior.reduce((s, w) => s + w.total, 0) / storedWeeks;

  const otherThisWeek = input.others.filter((o) => weekOf(o.publishedAt) === weekStart);
  return {
    formulaVersion: NEWS_SENTIMENT_VERSION,
    weekStart,
    buzz: { thisWeek: thisWeek.length, averagePerWeek, storedWeeks },
    sentiment: share(thisWeek.map((a) => a.label)),
    others: {
      ...share(otherThisWeek.map((o) => o.label)),
      tickers: new Set(otherThisWeek.map((o) => o.ticker)).size,
    },
    coverage,
  };
}
