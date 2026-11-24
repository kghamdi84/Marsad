-- Insider holdings (Phase 2). A Form 3 reports what an insider already holds, not trades, and a Form 4 or 5 can carry
-- a holdings table too. Filled by the insiders job with the secret key; readable only by the owner with MFA.
-- Additive: three new columns and one new table; no existing row changes.

-- A Form 3 can state outright that the person owns nothing (a fact, not missing data), a joint filing can name
-- several owners (the table keeps the first in owner_name), and an amendment names the date of the original.
alter table public.insider_filings
  add column co_owners text[] not null default '{}',
  add column no_securities_owned boolean,
  add column original_submission date;

create table public.insider_holdings (
  accession text not null references public.insider_filings (accession) on delete cascade,
  line integer not null,
  table_kind text not null check (table_kind in ('non-derivative', 'derivative')),
  security_title text,
  shares numeric,
  ownership text check (ownership in ('D', 'I')),
  nature_of_ownership text,
  exercise_price numeric,
  exercise_date date,
  expiration_date date,
  underlying_title text,
  underlying_shares numeric,
  footnotes text[] not null default '{}',
  primary key (accession, line)
);

alter table public.insider_holdings enable row level security;
create policy insider_holdings_owner_read on public.insider_holdings
  for select to authenticated using (private.is_app_owner());
revoke all on public.insider_holdings from anon, authenticated;
grant select on public.insider_holdings to authenticated;
