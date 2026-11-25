-- Thesis cards (Phase 2 item 2.10, ADR 0025). Personal and append-only: each save is a new version, so the history
-- of a view (and when it turned) is kept. The bear case and "what would change my view" are required by the
-- database as well as the app. Khaled writes them with MFA; there is no update or delete grant.
create table public.theses (
  id bigint generated always as identity primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ticker text not null check (ticker ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  version text not null default 'thesis-1',
  status text not null check (status in ('intact', 'weakening', 'broken')),
  bull text not null check (char_length(btrim(bull)) > 0 and char_length(bull) <= 4000),
  bear text not null check (char_length(btrim(bear)) >= 40 and char_length(bear) <= 4000),
  risks text[] not null check (cardinality(risks) between 1 and 10),
  change_view text not null check (char_length(btrim(change_view)) >= 40 and char_length(change_view) <= 2000),
  sources text[] not null default '{}' check (cardinality(sources) <= 10),
  created_at timestamptz not null default now()
);
create index theses_owner_ticker_idx on public.theses (owner_id, ticker, created_at desc);

alter table public.theses enable row level security;
create policy theses_owner on public.theses
  for all to authenticated
  using (private.is_mfa() and owner_id = (select auth.uid()))
  with check (private.is_mfa() and owner_id = (select auth.uid()));
revoke all on public.theses from anon, authenticated;
grant select, insert on public.theses to authenticated;
