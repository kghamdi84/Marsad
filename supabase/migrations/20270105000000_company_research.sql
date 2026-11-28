-- Company research from Tauric (ADR 0047): analyst consensus, company profile, the Tauric AI thesis and the earnings
-- and dividend calendar, one row per ticker, written by the `tauric-research` job with the secret key. Each part is
-- the vendor payload as validated by packages/core (company-research.ts, `tauric-research-1`) minus `instrument`,
-- or null when Tauric has none; `errors` says why per part ("not_registered", "temporarily_unavailable",
-- "malformed: ..."). A part that failed for a passing reason keeps its last good value, so the *_refreshed_at /
-- *_generated_at columns, not `fetched_at`, give each part's age.
--
-- Members (friends, ADR 0040) read it like the other shared vendor data: Tauric's terms allow displaying its data
-- and content in Marsad, and nobody is charged (ADR 0047, vendor terms). Nobody writes it from the app.
create table public.company_research (
  ticker text primary key check (ticker ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  source text not null default 'tauric' check (source in ('tauric')),
  analyst jsonb check (analyst is null or jsonb_typeof(analyst) = 'object'),
  profile jsonb check (profile is null or jsonb_typeof(profile) = 'object'),
  thesis jsonb check (thesis is null or jsonb_typeof(thesis) = 'object'),
  calendar jsonb check (calendar is null or jsonb_typeof(calendar) = 'object'),
  analyst_refreshed_at timestamptz,
  profile_refreshed_at timestamptz,
  thesis_generated_at timestamptz,
  calendar_refreshed_at timestamptz,
  fetched_at timestamptz not null default now(),
  errors jsonb not null default '{}'::jsonb check (jsonb_typeof(errors) = 'object')
);

alter table public.company_research enable row level security;
create policy company_research_member_read on public.company_research
  for select to authenticated using (private.is_member());
revoke all on public.company_research from anon, authenticated;
grant select on public.company_research to authenticated;
