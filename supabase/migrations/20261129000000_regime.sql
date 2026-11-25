-- Market regime (Phase 3, ADR 0009). Filled by the regime job with the secret key; readable only by the owner with
-- MFA. Every day keeps the inputs and rule version that produced its label, so any label can be recomputed and
-- compared (the Phase 3 "reproducible from stored inputs" criterion). Additive: two new tables.

create table public.regime_daily (
  date date primary key,
  rule_version text not null,
  label text not null check (label in ('stress', 'bear', 'recovery', 'bull-calm', 'bull-correction', 'insufficient-data')),
  reason text not null,
  inputs jsonb not null,
  recession_version text not null,
  recession_level text not null check (recession_level in ('low', 'elevated', 'high', 'unavailable')),
  recession jsonb not null,
  computed_at timestamptz not null default now()
);

-- Forward-return statistics per condition (a label, or a condition such as "VIX at or above 30") and horizon.
-- Fewer than 30 episodes is stored with sufficient = false; the page then shows "insufficient history".
create table public.regime_event_stats (
  rule_version text not null,
  condition text not null,
  horizon integer not null check (horizon > 0),
  n integer not null check (n >= 0),
  sufficient boolean not null,
  median numeric,
  q1 numeric,
  q3 numeric,
  min numeric,
  max numeric,
  episodes date[] not null default '{}',
  data_from date not null,
  data_to date not null,
  computed_at timestamptz not null default now(),
  primary key (rule_version, condition, horizon)
);

do $$
declare t text;
begin
  foreach t in array array['regime_daily', 'regime_event_stats']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (private.is_app_owner())', t || '_owner_read', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
