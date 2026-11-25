-- Catalyst watch scenarios (Phase 5 item 5.13, ADR 0030). Personal: Khaled writes them in advance with MFA. Each
-- names its tickers and keywords, its triggers, a written plan with a chase guard, and an expiry date. The daily
-- catalyst job reads them with the secret key and records matches as shadow alerts until live data exists.
create table public.catalyst_scenarios (
  id bigint generated always as identity primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  tickers text[] not null check (cardinality(tickers) between 1 and 10),
  keywords text[] not null default '{}' check (cardinality(keywords) <= 10),
  eight_k_items text[] not null default '{}',
  form4_codes text[] not null default '{}',
  news_min_tier smallint check (news_min_tier is null or news_min_tier between 1 and 4),
  halts boolean not null default false,
  move_pct numeric check (move_pct is null or (move_pct > 0 and move_pct < 1)),
  volume_ratio numeric check (volume_ratio is null or volume_ratio > 0),
  plan_entry text not null check (char_length(btrim(plan_entry)) between 1 and 500),
  chase_guard_pct numeric not null check (chase_guard_pct > 0 and chase_guard_pct < 1),
  plan_invalidation text not null check (char_length(btrim(plan_invalidation)) between 1 and 500),
  plan_size text not null default '' check (char_length(plan_size) <= 200),
  expires_on date not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (
    cardinality(eight_k_items) > 0 or cardinality(form4_codes) > 0 or news_min_tier is not null
    or halts or move_pct is not null
  )
);
create index catalyst_scenarios_owner_idx on public.catalyst_scenarios (owner_id, expires_on desc);

alter table public.catalyst_scenarios enable row level security;
create policy catalyst_scenarios_owner on public.catalyst_scenarios
  for all to authenticated
  using (private.is_mfa() and owner_id = (select auth.uid()))
  with check (private.is_mfa() and owner_id = (select auth.uid()));
revoke all on public.catalyst_scenarios from anon, authenticated;
grant select, insert, update, delete on public.catalyst_scenarios to authenticated;
