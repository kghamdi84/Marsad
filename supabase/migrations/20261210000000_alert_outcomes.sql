-- Alert outcomes for the scorecard (Phase 7, ADR 0023). One row per alert and horizon (1, 5 and 20 sessions),
-- computed from daily bars by the scorecard job: the directional return, SPY's return, the excess, the maximum
-- favorable and adverse excursions and which plan level was touched first. A finished row is never recomputed.
-- Every summary on the scorecard is computed from these rows. Written by jobs; owner-readable with MFA only.
create table public.alert_outcomes (
  alert_id uuid not null references public.alerts (id) on delete cascade,
  horizon text not null check (horizon in ('1d', '5d', '20d')),
  version text not null,
  status text not null check (status in ('done', 'pending', 'unavailable')),
  note text,
  ref_date date,
  end_date date,
  ret numeric,
  bench_ret numeric,
  excess numeric,
  mfe numeric,
  mae numeric,
  hit text check (hit is null or hit in ('stop', 'target', 'neither')),
  computed_at timestamptz not null default now(),
  primary key (alert_id, horizon),
  check (status <> 'done' or (ret is not null and ref_date is not null and end_date is not null))
);

alter table public.alert_outcomes enable row level security;
create policy alert_outcomes_owner_read on public.alert_outcomes
  for select to authenticated using (private.is_app_owner());
revoke all on public.alert_outcomes from anon, authenticated;
grant select on public.alert_outcomes to authenticated;
