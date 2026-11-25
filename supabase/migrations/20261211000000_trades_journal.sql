-- The trade journal (Phase 7, ADR 0024). Personal: trades Khaled placed in Sahm, written from the app with MFA.
-- Each trade may link the alert that prompted it, carries the pre-trade checklist and what was followed (for the
-- adherence score), notes and up to six screenshots kept in a private Storage bucket under the owner's folder.
create table public.trades (
  id bigint generated always as identity primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ticker text not null check (ticker ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  side text not null default 'long' check (side in ('long', 'short')),
  setup text not null default '' check (char_length(setup) <= 60),
  tags text[] not null default '{}' check (cardinality(tags) <= 10),
  alert_id uuid references public.alerts (id) on delete set null,
  entry_date date not null,
  entry_price numeric not null check (entry_price > 0),
  shares numeric not null check (shares > 0),
  stop numeric check (stop is null or stop > 0),
  target numeric check (target is null or target > 0),
  exit_date date,
  exit_price numeric check (exit_price is null or exit_price > 0),
  checklist jsonb not null default '{}'::jsonb,
  followed jsonb not null default '{}'::jsonb,
  notes text not null default '' check (char_length(notes) <= 4000),
  screenshots text[] not null default '{}' check (cardinality(screenshots) <= 6),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((exit_date is null) = (exit_price is null)),
  check (exit_date is null or exit_date >= entry_date)
);
create index trades_owner_idx on public.trades (owner_id, entry_date desc);

alter table public.trades enable row level security;
create policy trades_owner on public.trades
  for all to authenticated
  using (private.is_mfa() and owner_id = (select auth.uid()))
  with check (private.is_mfa() and owner_id = (select auth.uid()));
revoke all on public.trades from anon, authenticated;
grant select, insert, update, delete on public.trades to authenticated;

-- Screenshots: a private bucket (PNG, JPEG or WebP up to 5 MB). Objects live under "<owner id>/"; only that
-- owner, with MFA, can read or write them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('journal', 'journal', false, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy journal_owner_objects on storage.objects
  for all to authenticated
  using (
    bucket_id = 'journal'
    and private.is_mfa()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'journal'
    and private.is_mfa()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
