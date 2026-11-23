-- Marsad baseline schema (Phase 0).
-- Model: see docs/adr/0005-auth-and-row-level-security.md.
-- Every policy for signed-in users requires an MFA-verified (aal2) session.

-- ---------------------------------------------------------------------------
-- Private helpers (schema not exposed through the Data API)
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create table private.app_owners (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
revoke all on private.app_owners from public, anon, authenticated;
alter table private.app_owners enable row level security;

create function private.is_mfa()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

create function private.is_app_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_mfa()
     and exists (select 1 from private.app_owners o where o.user_id = auth.uid())
$$;

revoke execute on function private.is_mfa() from public;
revoke execute on function private.is_app_owner() from public;
grant execute on function private.is_mfa() to authenticated, service_role;
grant execute on function private.is_app_owner() to authenticated, service_role;

create function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function private.touch_updated_at() from public;

-- The anon role reads nothing in Marsad. Remove the platform's default grants
-- for tables, sequences and functions this role creates from now on.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;
alter default privileges in schema public revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- Personal tables: rows belong to one user (owner_id = auth.uid())
-- ---------------------------------------------------------------------------
create table public.user_settings (
  owner_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  local_time_zone text not null default 'Asia/Riyadh',
  show_sar boolean not null default false,
  sar_per_usd numeric(10, 4) not null default 3.75 check (sar_per_usd > 0),
  updown_palette text not null default 'blue-orange'
    check (updown_palette in ('blue-orange', 'green-red')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.watchlists (
  id bigint generated always as identity primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, name),
  unique (id, owner_id)
);

-- Tickers are display symbols. Phase 1 adds instrument identity (CIK, FIGI)
-- and links items to it, so ticker changes do not break history.
create table public.watchlist_items (
  id bigint generated always as identity primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  watchlist_id bigint not null,
  ticker text not null check (ticker ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  position integer not null default 0,
  added_at timestamptz not null default now(),
  unique (watchlist_id, ticker),
  -- An item can only point at a watchlist owned by the same user.
  foreign key (watchlist_id, owner_id) references public.watchlists (id, owner_id) on delete cascade
);
create index watchlist_items_owner_idx on public.watchlist_items (owner_id);

create trigger user_settings_touch before update on public.user_settings
  for each row execute function private.touch_updated_at();
create trigger watchlists_touch before update on public.watchlists
  for each row execute function private.touch_updated_at();

alter table public.user_settings enable row level security;
alter table public.watchlists enable row level security;
alter table public.watchlist_items enable row level security;

create policy user_settings_owner on public.user_settings
  for all to authenticated
  using (private.is_mfa() and owner_id = (select auth.uid()))
  with check (private.is_mfa() and owner_id = (select auth.uid()));

create policy watchlists_owner on public.watchlists
  for all to authenticated
  using (private.is_mfa() and owner_id = (select auth.uid()))
  with check (private.is_mfa() and owner_id = (select auth.uid()));

create policy watchlist_items_owner on public.watchlist_items
  for all to authenticated
  using (private.is_mfa() and owner_id = (select auth.uid()))
  with check (private.is_mfa() and owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- System tables: written by jobs with the secret key, read by the app owner
-- ---------------------------------------------------------------------------
create table public.job_runs (
  id bigint generated always as identity primary key,
  job text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'ok', 'error', 'skipped')),
  rows_written integer,
  latency_ms integer,
  error text,
  details jsonb not null default '{}'::jsonb
);
create index job_runs_job_started_idx on public.job_runs (job, started_at desc);

create table public.source_status (
  source text primary key,
  display_name text not null,
  last_message_at timestamptz,
  last_latency_ms integer,
  plan_tier text not null default 'unknown'
    check (plan_tier in ('real-time', 'delayed', 'end-of-day', 'unavailable', 'unknown')),
  state text not null default 'unknown'
    check (state in ('live', 'delayed', 'stale', 'unavailable', 'unknown')),
  note text,
  updated_at timestamptz not null default now()
);

alter table public.job_runs enable row level security;
alter table public.source_status enable row level security;

create policy job_runs_owner_read on public.job_runs
  for select to authenticated using (private.is_app_owner());
create policy source_status_owner_read on public.source_status
  for select to authenticated using (private.is_app_owner());

insert into public.source_status (source, display_name, note) values
  ('massive', 'Massive (market data)', 'Adapter arrives in Phase 1'),
  ('fred', 'FRED (St. Louis Fed)', 'Adapter arrives in Phase 1'),
  ('sec_edgar', 'SEC EDGAR', 'Adapter arrives in Phase 1'),
  ('nasdaq_halts', 'Nasdaq trade halts', 'Adapter arrives in Phase 1'),
  ('gpr', 'Geopolitical Risk Index', 'Adapter arrives in Phase 1');

-- ---------------------------------------------------------------------------
-- Privileges: anon gets nothing; authenticated gets only what policies allow
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all tables in schema public from authenticated;

grant select, insert, update, delete on public.user_settings to authenticated;
grant select, insert, update, delete on public.watchlists to authenticated;
grant select, insert, update, delete on public.watchlist_items to authenticated;
grant select on public.job_runs to authenticated;
grant select on public.source_status to authenticated;
