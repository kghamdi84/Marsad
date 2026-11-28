-- Whole-market movers (movers-1, ADR 0049; placement and access per ADR 0048). The breadth job writes, per session,
-- the gainers, losers, most active, unusual volume and new 52-week highs and lows over every common stock and ETF
-- stored that session, with the corporate-action checks and bad-print counts. Owner-only: Massive's plans are for
-- individual use, so whole-market data is not shared with members (ADR 0040). Additive: one new table, one nullable
-- column, and two read policies narrowed back to the owner.

create table public.market_movers_market (
  date date primary key,
  version text not null,
  session jsonb not null,
  computed_at timestamptz not null default now()
);

alter table public.market_movers_market enable row level security;
create policy market_movers_market_owner_read on public.market_movers_market
  for select to authenticated using (private.is_app_owner());
revoke all on public.market_movers_market from anon, authenticated;
grant select on public.market_movers_market to authenticated;

-- A member-readable marker on the shared movers row: the formula version of the owner-only row written for the same
-- session, so a member's screen can say "owner only" instead of "not computed yet". It carries no market data.
alter table public.market_movers_daily add column market_version text;

-- The raw whole-market snapshots and ticker lists go back to owner-only (they were opened to members by
-- 20261227000000_members.sql). No member screen reads them; the breadth job uses the secret key.
alter policy market_snapshots_owner_read on public.market_snapshots using (private.is_app_owner());
alter policy ticker_type_snapshots_owner_read on public.ticker_type_snapshots using (private.is_app_owner());
