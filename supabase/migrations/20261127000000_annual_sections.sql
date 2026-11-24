-- Annual report text for the year-over-year risk-factor comparison (Phase 2). Filled by the sections job with the
-- secret key; readable only by the owner with MFA. Same rules as every table: row-level security on, one owner-read
-- policy, nothing granted to anon. Additive: no existing table changes.

-- The plain text of one section (Item 1A risk factors, later Item 1 business) of one 10-K, as the vendor extracted
-- it. About 110 KB a row; two years for ten companies is about 2 MB. A fiscal year end plus the section identifies
-- a report: a 10-K/A would need its own key, and none is stored yet.
create table public.annual_sections (
  cik text not null check (cik ~ '^[0-9]{10}$'),
  ticker text not null check (ticker ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  section text not null check (section in ('business', 'risk_factors')),
  period_end date not null,
  filing_date date not null,
  filing_url text not null,
  text text not null check (length(text) > 0),
  fetched_at timestamptz not null default now(),
  primary key (cik, section, period_end)
);
create index annual_sections_ticker_idx on public.annual_sections (ticker, section, period_end desc);

alter table public.annual_sections enable row level security;
create policy annual_sections_owner_read on public.annual_sections
  for select to authenticated using (private.is_app_owner());
revoke all on public.annual_sections from anon, authenticated;
grant select on public.annual_sections to authenticated;

insert into public.source_status (source, display_name, note) values
  ('massive_sections', 'Massive 10-K sections', 'Weekly job (annual reports change once a year)')
on conflict (source) do nothing;
