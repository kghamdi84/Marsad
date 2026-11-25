-- Fear and Greed composite and capitulation watch (Phase 3, ADR 0011). Filled by the sentiment job with the secret
-- key; readable only by the owner with MFA. Every day keeps each component's raw value, score and window, and each
-- capitulation condition's value and threshold, so any reading can be recomputed. Additive: three new tables.

create table public.fear_greed_daily (
  date date primary key,
  version text not null,
  composite numeric check (composite is null or (composite >= 0 and composite <= 100)),
  label text check (label in ('extreme-fear', 'fear', 'neutral', 'greed', 'extreme-greed')),
  available integer not null check (available between 0 and 7),
  components jsonb not null,
  computed_at timestamptz not null default now(),
  check ((composite is null) = (label is null))
);

create table public.capitulation_daily (
  date date primary key,
  version text not null,
  state text not null check (state in ('on', 'off', 'unavailable')),
  conditions jsonb not null,
  computed_at timestamptz not null default now()
);

-- One staged-entry plan per episode (the first "on" day), re-evaluated on every run. Conditions, never orders.
create table public.capitulation_plans (
  trigger_date date primary key,
  version text not null,
  plan jsonb not null,
  computed_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['fear_greed_daily', 'capitulation_daily', 'capitulation_plans']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (private.is_app_owner())', t || '_owner_read', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
