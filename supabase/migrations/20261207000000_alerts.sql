-- Alerts (Phase 5, ADR 0019). Every signal the pipeline judges is stored with its full input snapshot, rule
-- version, decision and reasons (push, digest, shadow or suppress), the rendered card and the delivery log, so any
-- alert can be replayed and audited. Written by jobs with the secret key; owner-readable with MFA only.
-- Feedback is personal: the owner writes it from the app (MFA required).

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  version text not null,
  kind text not null check (kind in ('setup', 'opportunity', 'options', 'catalyst', 'regime', 'exit', 'rotation', 'halt', 'system')),
  priority text not null check (priority in ('critical', 'high', 'normal', 'digest')),
  ticker text check (ticker is null or ticker ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  rule_id text not null,
  rule_version integer not null,
  rule_status text not null check (rule_status in ('shadow', 'live')),
  dedupe_key text not null,
  decision text not null check (decision in ('push', 'digest', 'shadow', 'suppress')),
  reasons text[] not null default '{}',
  headline text not null check (char_length(headline) <= 120),
  push jsonb not null,
  card jsonb not null,
  input jsonb not null,
  -- When the source event happened or was first seen, for end-to-end latency.
  source_at timestamptz,
  latency_ms integer,
  delivery jsonb not null default '{}'::jsonb
);
create index alerts_created_idx on public.alerts (created_at desc);
create index alerts_key_idx on public.alerts (dedupe_key);

create table public.alert_feedback (
  id bigint generated always as identity primary key,
  alert_id uuid not null references public.alerts (id),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  verdict text not null check (verdict in ('useful', 'noise', 'acted')),
  created_at timestamptz not null default now(),
  unique (alert_id, owner_id)
);

alter table public.alerts enable row level security;
create policy alerts_owner_read on public.alerts
  for select to authenticated using (private.is_app_owner());
revoke all on public.alerts from anon, authenticated;
grant select on public.alerts to authenticated;

alter table public.alert_feedback enable row level security;
create policy alert_feedback_owner on public.alert_feedback
  for all to authenticated
  using (private.is_mfa() and owner_id = (select auth.uid()))
  with check (private.is_mfa() and owner_id = (select auth.uid()));
revoke all on public.alert_feedback from anon, authenticated;
grant select, insert, update, delete on public.alert_feedback to authenticated;
