-- Friends as members (ADR 0040, Khaled's request 2026-11-25). Anyone with a Marsad account is a member: members
-- read the shared market, research and lab tables. Khaled's own signals stay owner-only: alerts and their outcomes,
-- briefs (they name his holdings), AI usage, push devices and system alerts. Personal tables (holdings, trades,
-- journal, theses, watchlists, settings, option positions, catalyst scenarios) were already filtered by owner_id.
-- Sign-ups themselves are a Supabase Auth setting; this migration only decides what a signed-in member may read.

create function private.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and private.is_mfa()
$$;

revoke execute on function private.is_member() from public;
grant execute on function private.is_member() to authenticated, service_role;

do $$
declare
  p record;
begin
  for p in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and cmd = 'SELECT'
      and qual = 'private.is_app_owner()'
      and tablename not in (
        'alerts', 'alert_outcomes', 'briefs', 'ai_usage', 'push_subscriptions', 'system_alerts'
      )
  loop
    execute format('alter policy %I on public.%I using (private.is_member())', p.policyname, p.tablename);
  end loop;
end
$$;
