-- Watch dashboard movers and sector heatmap (Phase 3, ADR 0014). One row per session, written by the breadth job
-- from the stored market snapshots (the last 5 sessions are refreshed on each run). Owner-readable with MFA only.

create table public.market_movers_daily (
  date date primary key,
  version text not null,
  n integer not null check (n >= 0),
  gainers jsonb not null,
  losers jsonb not null,
  sectors jsonb not null,
  computed_at timestamptz not null default now()
);

alter table public.market_movers_daily enable row level security;
create policy market_movers_daily_owner_read on public.market_movers_daily
  for select to authenticated using (private.is_app_owner());
revoke all on public.market_movers_daily from anon, authenticated;
grant select on public.market_movers_daily to authenticated;
