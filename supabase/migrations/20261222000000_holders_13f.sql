-- Institutional holders from the SEC Form 13F data sets (Phase 2 follow-up, ADR 0037). Written by the weekly SEC job
-- with the secret key; owner-readable with MFA only. One list per company and report period, and its top filers.

create table public.holders_13f_lists (
  ticker text not null check (ticker ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  period date not null,
  data_set text not null,
  version text not null,
  filers integer not null check (filers >= 0),
  total_shares numeric not null check (total_shares >= 0),
  total_value_usd numeric not null check (total_value_usd >= 0),
  cusips jsonb not null,
  left_out jsonb not null,
  fetched_at timestamptz not null default now(),
  primary key (ticker, period)
);

create table public.holders_13f (
  ticker text not null,
  period date not null,
  rank integer not null check (rank >= 1),
  filer_cik text not null,
  filer_name text not null,
  shares numeric not null check (shares >= 0),
  value_usd numeric not null check (value_usd >= 0),
  share numeric not null check (share between 0 and 1),
  filing_date date,
  primary key (ticker, period, rank),
  foreign key (ticker, period) references public.holders_13f_lists (ticker, period) on delete cascade
);

alter table public.holders_13f_lists enable row level security;
create policy holders_13f_lists_owner_read on public.holders_13f_lists
  for select to authenticated using (private.is_app_owner());
revoke all on public.holders_13f_lists from anon, authenticated;
grant select on public.holders_13f_lists to authenticated;

alter table public.holders_13f enable row level security;
create policy holders_13f_owner_read on public.holders_13f
  for select to authenticated using (private.is_app_owner());
revoke all on public.holders_13f from anon, authenticated;
grant select on public.holders_13f to authenticated;
