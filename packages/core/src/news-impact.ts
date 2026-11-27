/**
 * News impact ranking (`impact-1`, Marsad v2 handoff): orders the Watch page's latest news and filings by how much
 * they are likely to matter to this watchlist and these holdings. Pure; the page computes it from rows it has
 * already loaded, so no column is stored.
 *
 * Points, added up (a documented judgment of this project, changed here in one place):
 * - Source tier: Tier 1 scores 3, Tier 2 scores 2, Tier 3 scores 1, Tier 4 scores 0. An opinion piece loses 1
 *   (never below 0).
 * - Filing item: an 8-K scores its highest item materiality (high 3, medium 2, low 0, no known item 1); a 10-K
 *   or 10-Q scores 2; any other form 1. News articles score 0 here.
 * - Match: naming a held ticker scores 3, else naming a watchlist ticker scores 2, else 0.
 * - Topic: the highest ratio, among the topics the headline matches, of the last 7 days to the 4-week weekly
 *   norm (`topics-1`): 2 or more scores 2, 1.5 or more scores 1, else 0. A missing ratio scores 0.
 *
 * Level: 8 points or more is high, 5 or more medium, otherwise low.
 *
 * Left out: the price move since publication. It needs prices after the item's time, and the page holds only
 * end-of-day bars, so it would mix a move from before the news with the reaction to it.
 */
import type { Materiality } from './filings.js';
import type { SourceTier } from './news.js';
import { topicsOf, type Topic } from './geopolitics.js';

export const IMPACT_VERSION = 'impact-1';

export const IMPACT_THRESHOLDS = Object.freeze({ high: 8, medium: 5 });

export type ImpactLevel = 'high' | 'medium' | 'low';

export interface ImpactItem {
  tier: SourceTier;
  /** True when the piece is analysis or opinion rather than reporting. */
  opinion?: boolean;
  /** Set for an SEC filing: its form and, for an 8-K, the highest materiality of its items. */
  filing?: { form: string; materiality: Materiality | 'unknown' } | null;
  tickers: readonly string[];
  /** The headline, matched against the topic rules. */
  title: string;
}

export interface ImpactContext {
  watchlist: readonly string[];
  holdings: readonly string[];
  /** Last 7 days over the 4-week weekly norm, per topic; null or missing when there is no norm. */
  topicRatios: Partial<Record<Topic, number | null>>;
}

export interface NewsImpact {
  version: string;
  score: number;
  level: ImpactLevel;
  points: { tier: number; filing: number; match: number; topic: number };
  /** Held tickers the item names. */
  held: string[];
  /** Watchlist tickers the item names that are not held. */
  watched: string[];
  /** The topic that scored, with its ratio; null when none did. */
  topic: { topic: Topic; ratio: number } | null;
}

const TIER_POINTS: Readonly<Record<SourceTier, number>> = { 1: 3, 2: 2, 3: 1, 4: 0 };
const MATERIALITY_POINTS: Readonly<Record<Materiality | 'unknown', number>> = {
  high: 3,
  medium: 2,
  low: 0,
  unknown: 1,
};

function filingPoints(f: ImpactItem['filing']): number {
  if (!f) return 0;
  const form = f.form.toUpperCase().replace(/\/A$/, '');
  if (form === '8-K') return MATERIALITY_POINTS[f.materiality];
  if (form === '10-K' || form === '10-Q') return 2;
  return 1;
}

/** The impact of one item for this watchlist and these holdings. */
export function newsImpact(item: ImpactItem, ctx: ImpactContext): NewsImpact {
  const tier = Math.max(0, TIER_POINTS[item.tier] - (item.opinion ? 1 : 0));
  const filing = filingPoints(item.filing);
  const names = [...new Set(item.tickers)];
  const heldSet = new Set(ctx.holdings);
  const watchSet = new Set(ctx.watchlist);
  const held = names.filter((t) => heldSet.has(t));
  const watched = names.filter((t) => !heldSet.has(t) && watchSet.has(t));
  const match = held.length > 0 ? 3 : watched.length > 0 ? 2 : 0;
  let topic: NewsImpact['topic'] = null;
  for (const tp of topicsOf(item.title)) {
    const r = ctx.topicRatios[tp];
    if (r === null || r === undefined || !Number.isFinite(r)) continue;
    if (!topic || r > topic.ratio) topic = { topic: tp, ratio: r };
  }
  const topicPts = !topic ? 0 : topic.ratio >= 2 ? 2 : topic.ratio >= 1.5 ? 1 : 0;
  if (topicPts === 0) topic = null;
  const score = tier + filing + match + topicPts;
  const level: ImpactLevel =
    score >= IMPACT_THRESHOLDS.high ? 'high' : score >= IMPACT_THRESHOLDS.medium ? 'medium' : 'low';
  return {
    version: IMPACT_VERSION,
    score,
    level,
    points: { tier, filing, match, topic: topicPts },
    held,
    watched,
    topic,
  };
}

/** Highest score first; ties go to the newer item, then to the id, so the order is stable. */
export function rankByImpact<T extends { id: string; at: string; impact: NewsImpact }>(
  items: readonly T[],
): T[] {
  return [...items].sort(
    (a, b) =>
      b.impact.score - a.impact.score ||
      Date.parse(b.at) - Date.parse(a.at) ||
      a.id.localeCompare(b.id),
  );
}
