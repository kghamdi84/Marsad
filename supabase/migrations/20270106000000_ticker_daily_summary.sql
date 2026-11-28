-- Nightly per-ticker summary (ADR 0048 section 4, ADR 0050; formula `ticker-summary-1`). One row per ticker per
-- session with the figures Watch, the quick look and Portfolio show, written by the `ticker-summary` job from the
-- stored bars, dividends, company research and earnings estimates with the same core functions the pages use
-- (packages/core/src/ticker-summary.ts). Additive: one table, one index, two read policies.
--
-- Units: returns, ATR, range position, yield and strength are fractions (0.12 is +12%); prices and dividends are
-- USD per share on today's share basis. A figure that cannot be computed is null, with its reason in
-- `unavailable`. `sources` names each input with its as-of time; `formula_versions` names every formula used.
--
-- Coverage:
--   'tracked': holdings, watchlists, SPY and the sector funds in use, every column. Built from tables members read
--              (daily_bars, dividends, company_research), so members read these rows (ADR 0040).
--   'market':  every common stock and ETF of the latest whole-market snapshot, price fields only. Built from
--              market_snapshots, which is owner-only (Massive plans are for individual use, ADR 0048), so these
--              rows are owner-only too. One table with one policy per coverage, so a page reads one table and the
--              screener later filters by coverage. The job does not write 'market' rows yet (ADR 0050: size).
-- Nobody signed in writes; no grants to anon.
create table public.ticker_daily_summary (
  version text not null,
  date date not null,
  ticker text not null check (ticker ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  coverage text not null check (coverage in ('tracked', 'market')),
  close numeric check (close > 0),
  close_date date check (close_date <= date),
  return_1w numeric,
  return_1m numeric,
  return_3m numeric,
  return_ytd numeric,
  return_1y numeric,
  high_52w numeric check (high_52w > 0),
  low_52w numeric check (low_52w > 0),
  range_position_52w numeric check (range_position_52w between 0 and 1),
  sma_20 numeric,
  sma_50 numeric,
  sma_200 numeric,
  above_sma_50 boolean,
  above_sma_200 boolean,
  rsi_14 numeric check (rsi_14 between 0 and 100),
  atr_14_pct numeric check (atr_14_pct >= 0),
  stretch_50_atr numeric,
  avg_volume_20 numeric check (avg_volume_20 >= 0),
  volume_ratio_20 numeric check (volume_ratio_20 >= 0),
  avg_dollar_volume_20 numeric check (avg_dollar_volume_20 >= 0),
  rs_spy_63 numeric,
  dividends_ttm numeric check (dividends_ttm >= 0),
  dividend_yield_ttm numeric check (dividend_yield_ttm >= 0),
  next_earnings_date date,
  next_earnings_source text check (next_earnings_source in ('tauric', 'marsad-estimate')),
  analyst_count integer check (analyst_count >= 0),
  analyst_target_mean numeric check (analyst_target_mean > 0),
  analyst_recommendation text
    check (analyst_recommendation in ('strong_buy', 'buy', 'hold', 'sell', 'strong_sell')),
  pe_ratio numeric,
  beta numeric,
  sector_etf text
    check (sector_etf in ('XLK', 'XLF', 'XLE', 'XLV', 'XLI', 'XLY', 'XLP', 'XLU', 'XLB', 'XLRE', 'XLC')),
  unavailable jsonb not null default '{}'::jsonb check (jsonb_typeof(unavailable) = 'object'),
  sources jsonb not null default '{}'::jsonb check (jsonb_typeof(sources) = 'object'),
  formula_versions jsonb not null check (jsonb_typeof(formula_versions) = 'object'),
  computed_at timestamptz not null default now(),
  primary key (version, date, ticker),
  check ((next_earnings_date is null) = (next_earnings_source is null)),
  check (low_52w is null or high_52w is null or low_52w <= high_52w)
);
create index ticker_daily_summary_ticker_idx on public.ticker_daily_summary (ticker, date desc);

alter table public.ticker_daily_summary enable row level security;
create policy ticker_daily_summary_member_read on public.ticker_daily_summary
  for select to authenticated using (coverage = 'tracked' and private.is_member());
create policy ticker_daily_summary_owner_read_market on public.ticker_daily_summary
  for select to authenticated using (coverage = 'market' and private.is_app_owner());
revoke all on public.ticker_daily_summary from anon, authenticated;
grant select on public.ticker_daily_summary to authenticated;
