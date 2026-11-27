-- Council leftovers (2026-11-27), additive only.
-- 1. strength_rank_daily: each universe member's 63-session return and its rank in the 1,000-stock universe
--    (formula strength-1), written nightly by the breadth job from the stored grouped-daily snapshots. Shared market
--    data, so members read it (ADR 0040); only the job writes it.
-- 2. watchlist_items.sector_etf: the sector fund a person picks for a watchlist ticker, so Watch can show strength
--    against the sector. Optional; null until set.

create table public.strength_rank_daily (
  version text not null,
  date date not null,
  ticker text not null check (ticker ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  return_63 numeric not null,
  rank integer not null check (rank >= 1),
  members integer not null check (members >= 1),
  percentile numeric not null check (percentile between 0 and 100),
  computed_at timestamptz not null default now(),
  primary key (version, date, ticker)
);
create index strength_rank_daily_ticker_idx on public.strength_rank_daily (ticker, date desc);

alter table public.strength_rank_daily enable row level security;
create policy strength_rank_daily_member_read on public.strength_rank_daily
  for select to authenticated using (private.is_member());
revoke all on public.strength_rank_daily from anon, authenticated;
grant select on public.strength_rank_daily to authenticated;

alter table public.watchlist_items
  add column sector_etf text
  check (
    sector_etf is null
    or sector_etf in ('XLK', 'XLF', 'XLE', 'XLV', 'XLI', 'XLY', 'XLP', 'XLU', 'XLB', 'XLRE', 'XLC')
  );
