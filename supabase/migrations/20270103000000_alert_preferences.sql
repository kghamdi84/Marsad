-- Quiet hours and the daily push cap on Settings (Marsad v2). The alert pipeline already holds non-critical alerts
-- to the digest during quiet hours and past the cap (ADR 0019), with fixed defaults of 23:00 to 07:00 Riyadh and 8
-- pushes a day. This lets the app owner change them. One row for the owner only: members cannot write one, so the
-- alert jobs (secret key) read at most one row. Without a row the defaults apply. Critical alerts still bypass both.
create table public.alert_preferences (
  owner_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  quiet_start text not null default '23:00' check (quiet_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  quiet_end text not null default '07:00' check (quiet_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  daily_push_cap integer not null default 8 check (daily_push_cap between 1 and 50),
  updated_at timestamptz not null default now()
);

alter table public.alert_preferences enable row level security;
create policy alert_preferences_owner on public.alert_preferences
  for all to authenticated
  using (private.is_mfa() and private.is_app_owner() and owner_id = (select auth.uid()))
  with check (private.is_mfa() and private.is_app_owner() and owner_id = (select auth.uid()));
revoke all on public.alert_preferences from anon, authenticated;
grant select, insert, update on public.alert_preferences to authenticated;
