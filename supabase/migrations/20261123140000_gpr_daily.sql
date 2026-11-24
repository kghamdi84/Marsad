-- Geopolitical Risk Index, daily (Phase 1). Filled by the GPR job; owner-readable with MFA.
create table public.gpr_daily (
  date date primary key,
  gprd numeric not null check (gprd >= 0),
  gprd_act numeric not null,
  gprd_threat numeric not null,
  gprd_ma7 numeric,
  gprd_ma30 numeric,
  fetched_at timestamptz not null default now()
);

alter table public.gpr_daily enable row level security;
create policy gpr_daily_owner_read on public.gpr_daily
  for select to authenticated using (private.is_app_owner());
revoke all on public.gpr_daily from anon, authenticated;
grant select on public.gpr_daily to authenticated;
