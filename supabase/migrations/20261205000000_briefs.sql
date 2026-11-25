-- Pre-market brief and close recap (Phase 3, ADR 0015). One row per kind and ET date, written by the brief job with
-- its full input snapshot (replay) and the delivery log. Owner-readable with MFA only.

create table public.briefs (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('pre-market', 'close-recap')),
  for_date date not null,
  version text not null,
  title text not null check (char_length(title) <= 60),
  push_body text not null check (char_length(push_body) <= 140),
  sections jsonb not null,
  inputs jsonb not null,
  delivery jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (kind, for_date)
);

alter table public.briefs enable row level security;
create policy briefs_owner_read on public.briefs
  for select to authenticated using (private.is_app_owner());
revoke all on public.briefs from anon, authenticated;
grant select on public.briefs to authenticated;
