/**
 * News source tiers, opinion labels and story clustering (integrity rule 14).
 *
 * Tiers: 1 SEC filings, company press releases and exchange notices; 2 established newswires; 3 analysis and
 * opinion sites; 4 social or unverified. The table is configurable by publisher and unknown publishers are
 * tier 4, never assumed reputable. A press-release wire (GlobeNewswire, PR Newswire, Business Wire) is tier 2
 * here because it distributes text from any customer, including market-research firms that are not the
 * company named in the headline (seen on 2026-11-24: a GlobeNewswire release by a research firm tagged NVDA).
 * Tier 1 is for the filing and exchange feeds Marsad reads itself, not for news publishers.
 */

export type SourceTier = 1 | 2 | 3 | 4;

export interface PublisherRule {
  tier: SourceTier;
  /** True when the publisher's pieces are analysis or opinion rather than reporting. */
  opinion: boolean;
}

export const TIER_LABELS: Readonly<Record<SourceTier, string>> = Object.freeze({
  1: 'Tier 1: filing, company release or exchange notice',
  2: 'Tier 2: established newswire',
  3: 'Tier 3: analysis and opinion',
  4: 'Tier 4: social or unverified',
});

/** Lowercases, drops punctuation and corporate suffixes: "GlobeNewswire Inc." becomes "globenewswire". */
export function normalizePublisher(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  while (words[0] === 'the') words.shift();
  while (['inc', 'llc', 'ltd', 'corp', 'co', 'plc'].includes(words.at(-1) ?? '')) words.pop();
  return words.join(' ');
}

const rule = (tier: SourceTier, opinion: boolean): PublisherRule => ({ tier, opinion });

/** Starting table, keyed by normalized publisher name. Edit here or pass your own table. */
export const DEFAULT_PUBLISHER_RULES: Readonly<Record<string, PublisherRule>> = Object.freeze({
  // Tier 2: established newswires and wires that distribute other people's releases.
  reuters: rule(2, false),
  'associated press': rule(2, false),
  ap: rule(2, false),
  bloomberg: rule(2, false),
  'dow jones': rule(2, false),
  'the wall street journal': rule(2, false),
  'wall street journal': rule(2, false),
  cnbc: rule(2, false),
  globenewswire: rule(2, false),
  'pr newswire': rule(2, false),
  prnewswire: rule(2, false),
  'business wire': rule(2, false),
  accesswire: rule(2, false),
  // Tier 3: analysis and opinion.
  'motley fool': rule(3, true),
  'zacks investment research': rule(3, true),
  zacks: rule(3, true),
  'seeking alpha': rule(3, true),
  benzinga: rule(3, false),
  marketbeat: rule(3, false),
  investopedia: rule(3, true),
  investorplace: rule(3, true),
  tipranks: rule(3, true),
  'investor s business daily': rule(3, false),
  // Tier 4: social.
  reddit: rule(4, true),
  stocktwits: rule(4, true),
  twitter: rule(4, true),
  x: rule(4, true),
});

export interface PublisherClass extends PublisherRule {
  /** False when the publisher is not in the table and was defaulted to tier 4. */
  known: boolean;
}

export function classifyPublisher(
  name: string,
  rules: Readonly<Record<string, PublisherRule>> = DEFAULT_PUBLISHER_RULES,
): PublisherClass {
  const found = rules[normalizePublisher(name)];
  return found ? { ...found, known: true } : { tier: 4, opinion: true, known: false };
}

export interface NewsItem {
  id: string;
  publisher: string;
  title: string;
  /** UTC ISO timestamp of publication. */
  publishedAt: string;
  url: string;
  tickers: readonly string[];
}

export interface NewsCluster {
  /** Id of the earliest article. */
  id: string;
  /** Publication time of the earliest article. */
  earliest: string;
  /** Articles, earliest first. */
  articles: NewsItem[];
  /** Distinct outlets, in order of first appearance. */
  outlets: string[];
  /** The most reliable tier among the articles (lowest number). */
  bestTier: SourceTier;
  /** True when every article is analysis or opinion, so the story is shown labelled as opinion. */
  opinionOnly: boolean;
}

const STOPWORDS = new Set(
  'a an and are as at be by for from has have how in is it its of on or that the this to was what why will with after before over into new says say said'.split(
    ' ',
  ),
);

/** Lowercase word tokens of a headline without filler words, for comparing headlines. */
export function headlineTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9%$.]+/g, ' ')
      .split(' ')
      .map((w) => w.replace(/^[.$]+|\.+$/g, ''))
      .filter((w) => w.length >= 2 && !STOPWORDS.has(w)),
  );
}

/** Tickers a headline names, as `(SFY)` or `$NVDA`. Two headlines naming different ones are about different things. */
export function headlineEntities(title: string): Set<string> {
  const out = new Set<string>();
  for (const m of title.matchAll(/\(([A-Z]{1,5}(?:[.-][A-Z])?)\)|\$([A-Z]{1,5})\b/g))
    out.add((m[1] ?? m[2]) as string);
  return out;
}

export function headlineSimilarity(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

export interface ClusterOptions {
  /** Jaccard similarity of headline words needed to call two articles the same story. Default 0.5. */
  threshold?: number;
  /** Minimum shared words, so very short headlines are not merged by chance. Default 3. */
  minShared?: number;
  /** Similarity needed when both articles come from the same outlet. Default 0.9: one outlet rarely publishes the same story twice under different headlines, but often publishes one template for many companies. */
  sameOutletThreshold?: number;
  /** Longest gap after the earliest article for a story to absorb another. Default 36 hours. */
  windowHours?: number;
  rules?: Readonly<Record<string, PublisherRule>>;
}

/**
 * Groups articles about the same story so ten outlets count once. An article joins the first cluster whose
 * earliest headline is similar enough, within the time window, and about a shared ticker. This is a word
 * overlap heuristic: it merges rewrites of one headline but cannot recognise a paraphrase, so a story may
 * stay split. It never merges articles that share too few words.
 */
export function clusterNews(
  items: readonly NewsItem[],
  options: ClusterOptions = {},
): NewsCluster[] {
  const threshold = options.threshold ?? 0.5;
  const minShared = options.minShared ?? 3;
  const sameOutlet = options.sameOutletThreshold ?? 0.9;
  const windowMs = (options.windowHours ?? 36) * 3_600_000;
  const rules = options.rules ?? DEFAULT_PUBLISHER_RULES;
  const sorted = [...new Map(items.map((i) => [i.id, i])).values()].sort(
    (a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt) || a.id.localeCompare(b.id),
  );
  const groups: { items: NewsItem[]; tokens: Set<string>; entities: Set<string>; first: number }[] =
    [];
  for (const item of sorted) {
    const tokens = headlineTokens(item.title);
    const entities = headlineEntities(item.title);
    const at = Date.parse(item.publishedAt);
    const home = groups.find((g) => {
      if (at - g.first > windowMs) return false;
      const head = g.items[0];
      if (!head) return false;
      const tickersKnown = item.tickers.length > 0 && head.tickers.length > 0;
      if (tickersKnown && !item.tickers.some((t) => head.tickers.includes(t))) return false;
      // Headlines that name different tickers are different stories, however alike their wording.
      if (entities.size > 0 && g.entities.size > 0 && ![...entities].some((e) => g.entities.has(e)))
        return false;
      let shared = 0;
      for (const t of tokens) if (g.tokens.has(t)) shared += 1;
      const same = normalizePublisher(head.publisher) === normalizePublisher(item.publisher);
      return (
        shared >= minShared &&
        headlineSimilarity(tokens, g.tokens) >= (same ? Math.max(threshold, sameOutlet) : threshold)
      );
    });
    if (home) home.items.push(item);
    else groups.push({ items: [item], tokens, entities, first: at });
  }
  return groups
    .map((g): NewsCluster => {
      const first = g.items[0] as NewsItem;
      const classes = g.items.map((i) => classifyPublisher(i.publisher, rules));
      const seen = new Set<string>();
      const outlets: string[] = [];
      for (const i of g.items) {
        const key = normalizePublisher(i.publisher);
        if (!seen.has(key)) {
          seen.add(key);
          outlets.push(i.publisher);
        }
      }
      return {
        id: first.id,
        earliest: first.publishedAt,
        articles: g.items,
        outlets,
        bestTier: Math.min(...classes.map((c) => c.tier)) as SourceTier,
        opinionOnly: classes.every((c) => c.opinion),
      };
    })
    .sort((a, b) => Date.parse(b.earliest) - Date.parse(a.earliest));
}
