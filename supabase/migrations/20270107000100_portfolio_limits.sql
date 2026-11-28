-- Portfolio limits (ADR 0048: "Portfolio limits, new in Settings"; round 2 decision 3). Each person's own limits for
-- their book: largest single position, top-5 share, minimum cash and maximum total open risk as fractions of
-- equity (0.2 is 20%), and maximum portfolio beta as a number. Null is "No limit set". Personal: one row per person,
-- read and written only by its owner with an MFA session (or password mode, ADR 0039). Nobody deletes a row;
-- clearing a limit stores null. `version` goes up by one on every save and `updated_at` records when.
-- `set_by` says who set the values: 'council' for the owner's seeded row (next migration), 'user' once edited.
create table public.portfolio_limits (
  owner_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  largest_position numeric check (largest_position > 0 and largest_position <= 1),
  top5 numeric check (top5 > 0 and top5 <= 1),
  min_cash numeric check (min_cash >= 0 and min_cash < 1),
  portfolio_beta numeric check (portfolio_beta > 0 and portfolio_beta <= 10),
  open_risk numeric check (open_risk > 0 and open_risk <= 1),
  set_by text not null default 'user' check (set_by in ('council', 'user')),
  set_on date not null default current_date,
  version integer not null default 1 check (version >= 1),
  updated_at timestamptz not null default now()
);

create function private.portfolio_limits_saved()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function private.portfolio_limits_saved() from public;

create trigger portfolio_limits_saved
  before update on public.portfolio_limits
  for each row execute function private.portfolio_limits_saved();

alter table public.portfolio_limits enable row level security;
create policy portfolio_limits_owner on public.portfolio_limits
  for all to authenticated
  using (private.is_mfa() and owner_id = (select auth.uid()))
  with check (private.is_mfa() and owner_id = (select auth.uid()));
revoke all on public.portfolio_limits from anon, authenticated;
grant select, insert, update on public.portfolio_limits to authenticated;
