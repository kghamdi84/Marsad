# ADR 0012: Geopolitical panel (news topic counts and reacting assets)

- Status: accepted (starting rules; every change bumps the version)
- Date: 2026-11-25
- Version: `topics-1`

## Context

The brief asks for a geopolitical panel: news topic counts (conflict, sanctions, tariffs, elections, central banks, energy) beside the assets that usually react (oil, gold, defense ITA, transports, Treasuries, the dollar). AI may tag topics later (claude-haiku-5-5 is named for topic tagging), but there is no API key yet, and "AI explains, code decides".

Measured on 2026-11-25 with the project key: Massive's news endpoint without a ticker returns market-wide news, about 500 articles a day, almost all investment press (The Motley Fool, Zacks, GlobeNewswire). There is no wire service (Reuters, AP), so the counts measure how much equity coverage mentions a topic, not world events directly.

## Decision

- **Classification** (`topics-1`): documented, case-insensitive whole-word rules on each article's title and description (`packages/core/src/geopolitics.ts`, `TOPIC_RULES`). Figurative wars ("trade war", "price war", "streaming wars" and similar) are removed before the conflict rule; "trade war" counts as tariffs. An article can count for several topics, once each.
- **Storage**: one row per UTC day in `news_topic_days` (total articles, count per topic, up to 3 newest headlines per topic with publisher and link). Articles themselves are not stored, so the database stays small.
- **Job** (`massive-topics`, daily at 01:20 UTC): fetches each missing complete UTC day of the last 35, plus the last 2 days again (late-indexed articles), paging by 1,000. Resumable; at most 40 days a run.
- **Reading**: the last 7 days against the weekly average of the 28 days before (scaled from the days stored, with the day counts shown), the share of all articles, and the ratio. No ratio when the baseline is zero.
- **Assets** beside it: WTI oil (FRED DCOILWTICO), the broad dollar (FRED DTWEXBGS), the 10-year Treasury yield (FRED DGS10), and Massive daily bars for GLD (gold), ITA (defense) and IYT (transports), each with its latest value, change over a month, 1-year percentile, date and source. GLD, ITA and IYT are stored as bars only (three more calls a day in the bars job).
- **GPR and EPU** also appear as one context line under the regime label (their 1-year percentiles).

## Consequences

- Keyword rules miss paraphrases and catch some boilerplate; the hand-labelled real sample in the tests shows what they do. Counts are labelled as investment-press coverage, not event counts.
- Topic tagging by AI can replace or check the rules later, as `topics-2`, once the API key and cost caps exist.
