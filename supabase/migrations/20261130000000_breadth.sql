-- Marsad universe breadth (Phase 3, ADR 0010). Filled by the breadth job with the secret key; readable only by the
-- owner with MFA. Additive: four new tables.

-- One session's grouped daily from Massive, unadjusted, compressed: the tickers that traded at least USD 100,000.
create table public.market_snapshots (
  date date primary key,
  adjusted boolean not null default false check (adjusted = false),
  tickers integer not null check (tickers >= 0),
  min_dollar_volume numeric not null,
  encoding text not null,
  payload text not null,
  fetched_at timestamptz not null default now()
);

-- Common stocks and ETFs as of a date (point in time, so delisted names count while they traded).
create table public.ticker_type_snapshots (
  as_of date primary key,
  common_stocks integer not null,
  etfs integer not null,
  encoding text not null,
  payload text not null,
  fetched_at timestamptz not null default now()
);

create table public.universe_members (
  version text not null,
  month_start date not null,
  ticker text not null check (ticker ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  rank integer not null check (rank between 1 and 1000),
  dollar_volume numeric not null,
  primary key (version, month_start, ticker)
);

create table public.breadth_daily (
  date date primary key,
  version text not null,
  members integer not null,
  with_change integer not null,
  advancers integer not null,
  decliners integer not null,
  unchanged integer not null,
  up_volume numeric not null,
  down_volume numeric not null,
  above50 integer not null,
  n50 integer not null,
  above200 integer not null,
  n200 integer not null,
  new_highs integer not null,
  new_lows integer not null,
  n252 integer not null,
  suspect integer not null,
  advance_avg10 numeric,
  zweig_thrust boolean not null default false,
  volume_ratio numeric,
  mcclellan_oscillator numeric,
  mcclellan_summation numeric,
  computed_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['market_snapshots', 'ticker_type_snapshots', 'universe_members', 'breadth_daily']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (private.is_app_owner())', t || '_owner_read', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

insert into public.source_status (source, display_name, note) values
  ('massive_breadth', 'Massive grouped daily (universe breadth)', 'Daily job after the close')
on conflict (source) do nothing;
