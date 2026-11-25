-- Quality at a discount (Phase 3 capitulation follow-up, ADR 0035). Written weekly by the quality-screen job with the
-- secret key; owner-readable with MFA only. One summary row per screen and the ranked companies of that screen.

create table public.quality_screen_runs (
  as_of date primary key,
  version text not null,
  fiscal_year integer not null,
  price_date date,
  universe integer not null check (universe >= 0),
  no_cik integer not null check (no_cik >= 0),
  eligible integer not null check (eligible >= 0),
  passed integer not null check (passed >= 0),
  excluded jsonb not null,
  insufficient text,
  created_at timestamptz not null default now()
);

create table public.quality_screen (
  as_of date not null references public.quality_screen_runs (as_of) on delete cascade,
  rank integer not null check (rank >= 1),
  ticker text not null check (ticker ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  cik text not null check (cik ~ '^[0-9]{10}$'),
  name text not null,
  passes boolean not null,
  quality numeric not null check (quality between 0 and 100),
  value numeric not null check (value between 0 and 100),
  combined numeric not null check (combined between 0 and 100),
  metrics jsonb not null,
  pct jsonb not null,
  notes text[] not null default '{}',
  price numeric not null check (price > 0),
  primary key (as_of, ticker)
);
create index quality_screen_rank_idx on public.quality_screen (as_of desc, rank);

alter table public.quality_screen_runs enable row level security;
create policy quality_screen_runs_owner_read on public.quality_screen_runs
  for select to authenticated using (private.is_app_owner());
revoke all on public.quality_screen_runs from anon, authenticated;
grant select on public.quality_screen_runs to authenticated;

alter table public.quality_screen enable row level security;
create policy quality_screen_owner_read on public.quality_screen
  for select to authenticated using (private.is_app_owner());
revoke all on public.quality_screen from anon, authenticated;
grant select on public.quality_screen to authenticated;
