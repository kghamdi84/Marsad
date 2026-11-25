-- Quarterly risk-factor updates (Phase 2 follow-up, ADR 0036): Part II, Item 1A of each stock's 10-Q filings, read
-- from the filing HTML by the SEC job. Written with the secret key; owner-readable with MFA only.

create table public.quarterly_sections (
  accession text primary key check (accession ~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$'),
  cik text not null check (cik ~ '^[0-9]{10}$'),
  ticker text not null check (ticker ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  period_end date,
  filing_date date not null,
  filing_url text not null check (filing_url ~ '^https://www\.sec\.gov/'),
  text text not null check (length(text) > 0),
  no_material_changes boolean not null,
  version text not null,
  fetched_at timestamptz not null default now()
);
create index quarterly_sections_cik_idx on public.quarterly_sections (cik, filing_date desc);

alter table public.quarterly_sections enable row level security;
create policy quarterly_sections_owner_read on public.quarterly_sections
  for select to authenticated using (private.is_app_owner());
revoke all on public.quarterly_sections from anon, authenticated;
grant select on public.quarterly_sections to authenticated;
