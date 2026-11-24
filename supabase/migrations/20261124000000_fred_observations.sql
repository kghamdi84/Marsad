-- FRED observations (Phase 1). Filled by the FRED job; owner-readable with MFA.
-- value is null where FRED publishes "." (no observation that day).
create table public.fred_observations (
  series_id text not null check (series_id ~ '^[A-Z0-9]{2,20}$'),
  date date not null,
  value numeric,
  fetched_at timestamptz not null default now(),
  primary key (series_id, date)
);
create index fred_observations_date_idx on public.fred_observations (date desc);

alter table public.fred_observations enable row level security;
create policy fred_observations_owner_read on public.fred_observations
  for select to authenticated using (private.is_app_owner());
revoke all on public.fred_observations from anon, authenticated;
grant select on public.fred_observations to authenticated;
