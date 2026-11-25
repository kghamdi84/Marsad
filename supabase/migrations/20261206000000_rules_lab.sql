-- Backtest lab (Phase 4, ADRs 0016 to 0018): rule versions, lifecycle events and backtest runs. Written by the
-- backtest runner with the secret key; owner-readable with MFA only. A rule version's content never changes (a
-- trigger refuses it): an edit is a new version. Only its status moves, and every move is logged in rule_events.

create table public.rules (
  id text not null check (id ~ '^[a-z0-9][a-z0-9-]{1,59}$'),
  version integer not null check (version >= 1),
  hash text not null check (hash ~ '^[0-9a-f]{8}$'),
  doc jsonb not null,
  status text not null default 'draft' check (status in ('draft', 'backtested', 'shadow', 'live', 'demoted')),
  source text not null default 'playbook' check (source in ('playbook', 'user')),
  created_at timestamptz not null default now(),
  primary key (id, version),
  unique (id, hash)
);

create function private.rules_immutable() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.version is distinct from old.version
     or new.hash is distinct from old.hash or new.doc is distinct from old.doc then
    raise exception 'rule versions are immutable; create a new version';
  end if;
  return new;
end;
$$;
revoke execute on function private.rules_immutable() from public;

create trigger rules_immutable before update on public.rules
  for each row execute function private.rules_immutable();

create table public.rule_events (
  id bigint generated always as identity primary key,
  rule_id text not null,
  version integer not null,
  from_status text,
  to_status text not null,
  reason text not null,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (rule_id, version) references public.rules (id, version)
);

create table public.backtest_runs (
  id bigint generated always as identity primary key,
  rule_id text not null,
  version integer not null,
  engine text not null,
  params jsonb not null,
  trials integer not null check (trials >= 1),
  report jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (rule_id, version) references public.rules (id, version)
);
create index backtest_runs_rule_idx on public.backtest_runs (rule_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['rules', 'rule_events', 'backtest_runs']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (private.is_app_owner())', t || '_owner_read', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
