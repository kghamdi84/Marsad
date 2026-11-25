-- ETF holdings from SEC Form N-PORT (Phase 7 follow-up, ADR 0038), for look-through exposure and ETF overlap.
-- Written weekly by the SEC job with the secret key; owner-readable with MFA only.

create table public.etf_reports (
  etf text not null check (etf ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  report_date date not null,
  accession text not null check (accession ~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$'),
  version text not null,
  holdings integer not null check (holdings >= 0),
  matched integer not null check (matched >= 0),
  net_assets numeric,
  fetched_at timestamptz not null default now(),
  primary key (etf, report_date)
);

create table public.etf_holdings (
  etf text not null,
  report_date date not null,
  rank integer not null check (rank >= 1),
  name text not null,
  cusip text check (cusip is null or cusip ~ '^[0-9A-Z]{9}$'),
  isin text,
  ticker text check (ticker is null or ticker ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  weight numeric not null,
  value_usd numeric not null,
  asset_cat text not null,
  primary key (etf, report_date, rank),
  foreign key (etf, report_date) references public.etf_reports (etf, report_date) on delete cascade
);
create index etf_holdings_ticker_idx on public.etf_holdings (ticker);

alter table public.etf_reports enable row level security;
create policy etf_reports_owner_read on public.etf_reports
  for select to authenticated using (private.is_app_owner());
revoke all on public.etf_reports from anon, authenticated;
grant select on public.etf_reports to authenticated;

alter table public.etf_holdings enable row level security;
create policy etf_holdings_owner_read on public.etf_holdings
  for select to authenticated using (private.is_app_owner());
revoke all on public.etf_holdings from anon, authenticated;
grant select on public.etf_holdings to authenticated;
