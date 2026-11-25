-- Holdings with their exit rules (Phase 7, ADR 0020). Personal: the owner writes them from the app with MFA, by
-- hand or by CSV upload. Every holding carries explicit exit conditions (stop, targets, trend break, time stop).

create table public.holdings (
  id bigint generated always as identity primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ticker text not null check (ticker ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  shares numeric not null check (shares > 0),
  cost_basis numeric not null check (cost_basis > 0),
  opened_on date not null,
  stop numeric check (stop is null or stop > 0),
  targets numeric[] not null default '{}',
  trend_break text check (trend_break is null or trend_break ~ '^(sma|ema)[0-9]{1,3}$'),
  time_stop_sessions integer check (time_stop_sessions is null or time_stop_sessions > 0),
  thesis text check (thesis is null or char_length(thesis) <= 2000),
  thesis_break text check (thesis_break is null or char_length(thesis_break) <= 2000),
  closed_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index holdings_owner_idx on public.holdings (owner_id);

alter table public.holdings enable row level security;
create policy holdings_owner on public.holdings
  for all to authenticated
  using (private.is_mfa() and owner_id = (select auth.uid()))
  with check (private.is_mfa() and owner_id = (select auth.uid()));
revoke all on public.holdings from anon, authenticated;
grant select, insert, update, delete on public.holdings to authenticated;
