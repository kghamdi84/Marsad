-- Study module data (Phase 2). Filled by the jobs with the secret key; readable only by the owner with MFA.
-- Every table: row-level security on, one owner-read policy, nothing granted to anon.

-- XBRL financial facts, as filed. Many filings repeat a period (comparison figures, restatements), so the
-- filing that reported each value is part of the key and point-in-time queries pick the latest filing on or
-- before a date. `fact_key` is built by the job from the columns that identify a row.
create table public.financial_facts (
  fact_key text primary key,
  cik text not null check (cik ~ '^[0-9]{10}$'),
  taxonomy text not null,
  concept text not null,
  unit text not null,
  period_start date,
  period_end date not null,
  value numeric not null,
  accession text not null,
  form text not null,
  fiscal_year integer,
  fiscal_period text,
  filed date not null,
  frame text,
  fetched_at timestamptz not null default now()
);
create index financial_facts_cik_concept_idx on public.financial_facts (cik, concept, period_end desc);
create index financial_facts_filed_idx on public.financial_facts (cik, filed);

-- One row per Form 3, 4 or 5 filing that has been read (or failed to be read), and one row per transaction.
create table public.insider_filings (
  accession text primary key,
  issuer_cik text not null check (issuer_cik ~ '^[0-9]{10}$'),
  status text not null check (status in ('ok', 'error')),
  error text,
  document_type text,
  period_of_report date,
  owner_cik text,
  owner_name text,
  is_director boolean,
  is_officer boolean,
  officer_title text,
  is_ten_percent_owner boolean,
  plan_10b5 boolean,
  filed_at timestamptz,
  parsed_at timestamptz not null default now()
);
create index insider_filings_issuer_idx on public.insider_filings (issuer_cik, period_of_report desc);

create table public.insider_transactions (
  accession text not null references public.insider_filings (accession) on delete cascade,
  line integer not null,
  table_kind text not null check (table_kind in ('non-derivative', 'derivative')),
  security_title text,
  trade_date date not null,
  code text not null,
  shares numeric,
  price_per_share numeric,
  acquired_disposed text check (acquired_disposed in ('A', 'D')),
  shares_after numeric,
  ownership text check (ownership in ('D', 'I')),
  exercise_price numeric,
  value_usd numeric,
  footnotes text[] not null default '{}',
  primary key (accession, line)
);
create index insider_transactions_date_idx on public.insider_transactions (trade_date desc);

create table public.news_articles (
  id text primary key,
  published_at timestamptz not null,
  publisher text not null,
  title text not null,
  url text not null,
  author text,
  tickers text[] not null default '{}',
  description text,
  sentiment jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now()
);
create index news_articles_published_idx on public.news_articles (published_at desc);
create index news_articles_tickers_idx on public.news_articles using gin (tickers);

create table public.short_interest (
  ticker text not null check (ticker ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  settlement_date date not null,
  short_interest numeric not null,
  avg_daily_volume numeric,
  days_to_cover numeric,
  fetched_at timestamptz not null default now(),
  primary key (ticker, settlement_date)
);

create table public.short_volume (
  ticker text not null check (ticker ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  date date not null,
  total_volume numeric not null,
  short_volume numeric not null,
  short_volume_ratio numeric,
  exempt_volume numeric,
  fetched_at timestamptz not null default now(),
  primary key (ticker, date)
);

create table public.dividends (
  id text primary key,
  ticker text not null check (ticker ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  ex_dividend_date date not null,
  record_date date,
  pay_date date,
  declaration_date date,
  cash_amount numeric not null,
  currency text not null default 'USD',
  frequency integer,
  distribution_type text,
  split_adjusted_cash_amount numeric,
  fetched_at timestamptz not null default now()
);
create index dividends_ticker_idx on public.dividends (ticker, ex_dividend_date desc);

do $$
declare t text;
begin
  foreach t in array array['financial_facts', 'insider_filings', 'insider_transactions', 'news_articles', 'short_interest', 'short_volume', 'dividends']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (private.is_app_owner())', t || '_owner_read', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

insert into public.source_status (source, display_name, note) values
  ('sec_facts', 'SEC financial statements (XBRL)', 'Daily job'),
  ('sec_insiders', 'SEC insider filings (Form 4)', 'Hourly job on weekdays'),
  ('massive_news', 'Massive news', 'Three runs on weekdays'),
  ('massive_study', 'Massive short data and dividends', 'Daily job after the close')
on conflict (source) do nothing;
