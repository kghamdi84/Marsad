-- Daily bars (Phase 2, Study chart). Filled by the bars job from Massive, split-adjusted as of fetched_at.
-- The job re-fetches the whole two-year window every run (the free plan's limit), so a new split rewrites
-- history consistently instead of leaving old rows on the old scale. Owner-readable with MFA only.
create table public.daily_bars (
  ticker text not null check (ticker ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  date date not null,
  open numeric not null,
  high numeric not null,
  low numeric not null,
  close numeric not null,
  volume numeric not null,
  vwap numeric,
  fetched_at timestamptz not null default now(),
  primary key (ticker, date),
  check (high >= low and close <= high and close >= low)
);
create index daily_bars_ticker_date_idx on public.daily_bars (ticker, date desc);

alter table public.daily_bars enable row level security;
create policy daily_bars_owner_read on public.daily_bars
  for select to authenticated using (private.is_app_owner());
revoke all on public.daily_bars from anon, authenticated;
grant select on public.daily_bars to authenticated;

insert into public.source_status (source, display_name, note)
values ('massive_bars', 'Massive daily bars', 'Daily job after the close')
on conflict (source) do nothing;
