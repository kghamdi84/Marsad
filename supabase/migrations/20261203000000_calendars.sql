-- Economic and earnings calendars (Phase 3, ADR 0013). Append-only snapshots: each run of the calendar job writes
-- one row of upcoming events and one row of earnings estimates; the page reads the newest. A rescheduled release
-- therefore never leaves a stale date behind, and nothing is deleted. Owner-readable with MFA only.

create table public.econ_calendar_snapshots (
  fetched_at timestamptz primary key,
  version text not null,
  range_from date not null,
  range_to date not null,
  events jsonb not null
);

create table public.earnings_estimate_snapshots (
  computed_at timestamptz primary key,
  version text not null,
  estimates jsonb not null
);

do $$
declare t text;
begin
  foreach t in array array['econ_calendar_snapshots', 'earnings_estimate_snapshots']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (private.is_app_owner())', t || '_owner_read', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
