-- Covering indexes for the six foreign keys the Supabase Performance Advisor listed as unindexed (2026-11-25).
-- Additive only. Deletes on the referenced rows (and the policy filters on owner_id) no longer scan these tables.

create index if not exists alert_feedback_owner_idx on public.alert_feedback (owner_id);
create index if not exists backtest_runs_rule_version_idx on public.backtest_runs (rule_id, version);
create index if not exists rule_events_rule_version_idx on public.rule_events (rule_id, version);
create index if not exists splits_instrument_idx on public.splits (instrument_id);
create index if not exists trades_alert_idx on public.trades (alert_id);
create index if not exists watchlist_items_watchlist_idx on public.watchlist_items (watchlist_id, owner_id);
