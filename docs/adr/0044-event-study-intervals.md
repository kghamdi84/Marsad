# ADR 0044: 90% bootstrap intervals for the regime event study

- Status: accepted
- Date: 2026-11-27

## Context

The Regime page's event study ("What the S&P did next", ADR 0009) showed the median forward return and the middle half (25th to 75th percentile) of outcomes. The design and integrity rule 10 ask for a 90% interval. The stored study had no bootstrap figures, so adding them meant a job change and a migration; Khaled approved it on 2026-11-27.

## Decision

1. `event-study-2` (`packages/core/src/regime.ts`): for each condition and horizon with at least 30 episodes, a 90% percentile-bootstrap interval of the median, from 2,000 resamples with replacement and a fixed seed (1), using the existing `bootstrap` and `mulberry32` in `stats.ts`. The same inputs always give the same interval, so stored figures can be replayed. Below 30 episodes there is no interval, like every other figure.
2. Known-answer test: the interval for forty fixed returns matches a reference computed with a Python port of the seeded generator and numpy 2.5.5 `quantile(method='linear')`, to 1e-12.
3. Storage: two nullable columns on `regime_event_stats` (`ci_low`, `ci_high`; additive migration `20261231000000_event_study_ci.sql`), written by the regime job on its next run.
4. Display: the bar is the 90% interval and the line under it reads "90% interval a to b"; the subtitle reads "Median and 90% interval". Rows stored before the next run have no interval and fall back to the middle half, labelled as such.

## Consequences

- The interval describes uncertainty in the median from the episodes Marsad has, which overlap in market conditions even when their windows do not. It is not a forecast range.
- With 10 years of S&P 500 data most labels still have fewer than 30 episodes, so most rows keep saying "Insufficient history (n of 30)" until a longer price history is available (ADR 0009).
