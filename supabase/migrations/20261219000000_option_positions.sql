-- Options positions entered by hand (Phase 7, ADR 0034). Personal: the owner writes them from the app with MFA.
-- Every position carries at least one exit rule and a bear case; the app also refuses undefined-risk structures.

create table public.option_positions (
  id bigint generated always as identity primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  underlying text not null check (underlying ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  label text not null check (char_length(label) between 1 and 60),
  expiry date not null,
  -- [{type: call|put, strike, qty (contracts, negative short), price (premium per share)}], 1 to 4 legs.
  legs jsonb not null check (jsonb_typeof(legs) = 'array' and jsonb_array_length(legs) between 1 and 4),
  opened_on date not null,
  exit_dte integer check (exit_dte is null or exit_dte >= 0),
  profit_take_pct numeric check (profit_take_pct is null or (profit_take_pct > 0 and profit_take_pct <= 1)),
  loss_limit_pct numeric check (loss_limit_pct is null or (loss_limit_pct > 0 and loss_limit_pct <= 1)),
  bear_case text not null check (char_length(btrim(bear_case)) between 1 and 2000),
  closed_on date,
  close_note text check (close_note is null or char_length(close_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (exit_dte is not null or profit_take_pct is not null or loss_limit_pct is not null),
  check (closed_on is null or closed_on >= opened_on)
);
create index option_positions_owner_idx on public.option_positions (owner_id);
create trigger option_positions_touch before update on public.option_positions
  for each row execute function private.touch_updated_at();

alter table public.option_positions enable row level security;
create policy option_positions_owner on public.option_positions
  for all to authenticated
  using (private.is_mfa() and owner_id = (select auth.uid()))
  with check (private.is_mfa() and owner_id = (select auth.uid()));
revoke all on public.option_positions from anon, authenticated;
grant select, insert, update, delete on public.option_positions to authenticated;
