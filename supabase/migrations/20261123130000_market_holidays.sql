-- Market holidays and early closes (Phase 1, item 1.7), filled by the calendar job from the vendor's
-- market-status endpoint. System table: owner-readable with MFA, written with the secret key.
create table public.market_holidays (
  date date not null,
  exchange text not null,
  name text not null,
  status text not null check (status in ('closed', 'early-close')),
  open_at timestamptz,
  close_at timestamptz,
  fetched_at timestamptz not null default now(),
  primary key (exchange, date)
);

alter table public.market_holidays enable row level security;
create policy market_holidays_owner_read on public.market_holidays
  for select to authenticated using (private.is_app_owner());
revoke all on public.market_holidays from anon, authenticated;
grant select on public.market_holidays to authenticated;
