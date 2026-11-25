-- Web Push (Phase 5, ADR 0031). Additive only.
-- push_subscriptions: one row per device that turned notifications on. Personal (the app owner with MFA writes and
-- reads their own rows); the dispatcher job reads all rows and records results with the secret key. Endpoints must
-- belong to a known push service, so a stored row can never make the job post anywhere else.

create table public.push_subscriptions (
  id bigint generated always as identity primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null unique check (
    char_length(endpoint) <= 1000
    and endpoint ~ '^https://([A-Za-z0-9-]+\.)*(push\.apple\.com|fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com)/'
  ),
  -- The browser's P-256 key (65 bytes) and auth secret (16 bytes), base64url without padding.
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{87}$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]{22}$'),
  device text not null default '' check (char_length(device) <= 80),
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 300),
  failures integer not null default 0 check (failures >= 0),
  -- Set when the push service says the subscription is gone (404 or 410); never sent to again.
  disabled_at timestamptz
);
create index push_subscriptions_owner_idx on public.push_subscriptions (owner_id);

alter table public.push_subscriptions enable row level security;
create policy push_subscriptions_owner on public.push_subscriptions
  for all to authenticated
  using (private.is_app_owner() and owner_id = (select auth.uid()))
  with check (private.is_app_owner() and owner_id = (select auth.uid()));
revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- The VAPID public key the browser subscribes with. Not a secret; the private half lives only in the GitHub
-- Actions secret VAPID_PRIVATE_KEY, and the job refuses to send when the two do not match.
alter table public.user_settings
  add column push_public_key text check (push_public_key is null or push_public_key ~ '^[A-Za-z0-9_-]{87}$');

-- System alerts gain the same delivery log alerts and briefs have. Existing rows stay '{}' (never pushed).
alter table public.system_alerts
  add column delivery jsonb not null default '{}'::jsonb;
