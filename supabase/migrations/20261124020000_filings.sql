-- SEC filings (Phase 1). Filled by the SEC job; owner-readable with MFA.
-- A CIK identifies one instrument row, so the job can upsert instruments by CIK.
alter table public.instruments add constraint instruments_cik_key unique (cik);

create table public.filings (
  accession text primary key check (accession ~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$'),
  cik text not null check (cik ~ '^[0-9]{10}$'),
  form text not null,
  filing_date date not null,
  accepted_at timestamptz,
  primary_document text,
  items text[] not null default '{}',
  fetched_at timestamptz not null default now()
);
create index filings_cik_date_idx on public.filings (cik, filing_date desc);
create index filings_form_date_idx on public.filings (form, filing_date desc);

alter table public.filings enable row level security;
create policy filings_owner_read on public.filings
  for select to authenticated using (private.is_app_owner());
revoke all on public.filings from anon, authenticated;
grant select on public.filings to authenticated;
