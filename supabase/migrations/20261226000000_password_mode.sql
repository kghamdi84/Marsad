-- Password-only sign-in while Marsad is being tested (ADR 0039, Khaled's request 2026-11-25).
-- One switch decides whether row-level security requires a second factor (aal2). It starts off: a signed-in
-- session at aal1 (email and password) counts. Every policy still requires private.is_app_owner() or owner_id =
-- auth.uid(), sign-ups stay closed and the anon role keeps no grants, so only Khaled's account reads anything.
-- To require the authenticator app again: update private.auth_policy set require_mfa = true (one migration),
-- and set REQUIRE_MFA to true in apps/web/src/auth/policy.ts.

create table private.auth_policy (
  id boolean primary key default true check (id),
  require_mfa boolean not null
);
insert into private.auth_policy (id, require_mfa) values (true, false);
revoke all on private.auth_policy from public, anon, authenticated;
alter table private.auth_policy enable row level security;

-- Security definer so it can read the switch; it still reads only the caller's own JWT claims.
create or replace function private.is_mfa()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      or (
        coalesce(auth.jwt() ->> 'role', '') = 'authenticated'
        and coalesce(auth.jwt() ->> 'aal', '') = 'aal1'
        and not coalesce((select p.require_mfa from private.auth_policy p where p.id), true)
      )
$$;

revoke execute on function private.is_mfa() from public;
grant execute on function private.is_mfa() to authenticated, service_role;
