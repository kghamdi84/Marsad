-- event-study-2 (2026-11-27, Khaled's go-ahead): the 90% bootstrap interval of the median forward return for each
-- condition and horizon (2,000 seeded resamples; null below 30 episodes). Additive: two nullable columns, filled by
-- the next regime job run. Existing rows keep null until then, and the page falls back to the middle half.
alter table public.regime_event_stats
  add column ci_low numeric,
  add column ci_high numeric;
