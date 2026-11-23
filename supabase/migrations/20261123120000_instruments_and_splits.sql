-- Instrument identity and corporate actions (Phase 1, item 1.8).
-- System tables: written by jobs with the secret key, readable only by the app owner with MFA.
-- Companies are keyed by FIGI and CIK, not ticker, so a ticker change does not break history.

create table public.instruments (
  id bigint generated always as identity primary key,
  figi text unique check (figi ~ '^BBG[A-Z0-9]{9}$'),
  cik text check (cik ~ '^[0-9]{10}$'),
  ticker text not null check (ticker ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  name text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index instruments_cik_idx on public.instruments (cik);
create index instruments_ticker_idx on public.instruments (ticker);

-- One row per ticker an instrument has used, so history survives a rename.
create table public.instrument_tickers (
  id bigint generated always as identity primary key,
  instrument_id bigint not null references public.instruments (id) on delete cascade,
  ticker text not null check (ticker ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  valid_from date,
  valid_to date,
  check (valid_to is null or valid_from is null or valid_to >= valid_from),
  unique (instrument_id, ticker, valid_from)
);
create index instrument_tickers_ticker_idx on public.instrument_tickers (ticker);

-- Splits, as reported by the vendor. historical_adjustment_factor is cumulative (this split and
-- every later one). Prices are numeric, never float.
create table public.splits (
  vendor_id text primary key,
  instrument_id bigint references public.instruments (id) on delete set null,
  ticker text not null,
  execution_date date not null,
  split_from numeric not null check (split_from > 0),
  split_to numeric not null check (split_to > 0),
  adjustment_type text not null,
  historical_adjustment_factor numeric,
  fetched_at timestamptz not null default now()
);
create index splits_ticker_date_idx on public.splits (ticker, execution_date desc);

create trigger instruments_touch before update on public.instruments
  for each row execute function private.touch_updated_at();

alter table public.instruments enable row level security;
alter table public.instrument_tickers enable row level security;
alter table public.splits enable row level security;

create policy instruments_owner_read on public.instruments
  for select to authenticated using (private.is_app_owner());
create policy instrument_tickers_owner_read on public.instrument_tickers
  for select to authenticated using (private.is_app_owner());
create policy splits_owner_read on public.splits
  for select to authenticated using (private.is_app_owner());

-- Default privileges give anon and authenticated broad grants on new tables; take them back.
revoke all on public.instruments, public.instrument_tickers, public.splits from anon, authenticated;
grant select on public.instruments, public.instrument_tickers, public.splits to authenticated;
