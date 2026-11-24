-- System alerts (Phase 1): feed stale, feed recovered, cross-source mismatch. Written by jobs with the
-- secret key; owner-readable with MFA. An alert keeps the input snapshot and the policy version that
-- produced it, so it can be replayed. Delivery (push, Telegram, email) arrives in Phase 5.
-- The newest stale/recovered row per source is also the previous state the heartbeat compares against,
-- so a feed that stays down raises one alert, not one per check.
create table public.system_alerts (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  event text not null check (event in ('stale', 'recovered', 'mismatch')),
  source text not null,
  priority text not null default 'critical' check (priority = 'critical'),
  headline text not null check (char_length(headline) <= 90),
  trigger text not null,
  paused_rules text[] not null default '{}',
  last_good_at timestamptz,
  policy_version text not null,
  snapshot jsonb not null default '{}'::jsonb
);
create index system_alerts_source_idx on public.system_alerts (source, created_at desc);
create index system_alerts_created_idx on public.system_alerts (created_at desc);

alter table public.system_alerts enable row level security;
create policy system_alerts_owner_read on public.system_alerts
  for select to authenticated using (private.is_app_owner());
revoke all on public.system_alerts from anon, authenticated;
grant select on public.system_alerts to authenticated;
