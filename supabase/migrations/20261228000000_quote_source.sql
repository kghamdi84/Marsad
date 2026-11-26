-- Quote source (ADR 0041). Each person picks which vendor's latest price the Watch list and the company page show:
-- Massive (the default; end-of-day closes on the current plan) or Tauric (snapshot quotes whose delay is not
-- confirmed yet). The choice is display only: stored daily bars, indicators, backtests, rules and alerts keep
-- Massive as their one source of record and never read it. It lives in the personal settings row, so the
-- existing policies (owner_id = auth.uid()) already cover it.
alter table public.user_settings
  add column quote_source text not null default 'massive'
    check (quote_source in ('massive', 'tauric'));

-- The latest quote per ticker and vendor, written by the quotes job with the secret key. One row per pair: it is
-- a display cache, not a history (daily bars are the history). `price_time` is the vendor's last-trade time;
-- `fetched_at` is when Marsad received it. Freshness is judged from these two, never from the vendor's own
-- age or stale flag (Tauric reported a 30-minute-old FX quote as 5 seconds old, 2026-11-26).
create table public.price_quotes (
  ticker text not null check (ticker ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  source text not null check (source in ('tauric')),
  price numeric not null check (price > 0),
  quote_kind text not null check (quote_kind in ('snapshot', 'last_close', 'exchange_quote')),
  price_time timestamptz,
  session_date date,
  previous_close numeric check (previous_close > 0),
  previous_close_date date,
  change numeric,
  day_volume numeric check (day_volume >= 0),
  market_state text,
  vendor_refreshed_at timestamptz,
  plan_tier text not null default 'unknown'
    check (plan_tier in ('real-time', 'delayed', 'end-of-day', 'unknown')),
  fetched_at timestamptz not null,
  primary key (ticker, source)
);

alter table public.price_quotes enable row level security;
create policy price_quotes_member_read on public.price_quotes
  for select to authenticated using (private.is_member());
revoke all on public.price_quotes from anon, authenticated;
grant select on public.price_quotes to authenticated;

insert into public.source_status (source, display_name, plan_tier, note)
values (
  'tauric',
  'Tauric (quotes)',
  'unknown',
  'Second quote source (ADR 0041). Waits for the TAURIC_API_KEY repository secret; delay not confirmed yet.'
)
on conflict (source) do nothing;
