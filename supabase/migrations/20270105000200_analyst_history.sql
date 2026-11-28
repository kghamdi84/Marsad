-- Analyst recommendation history (ADR 0047): one row per ticker per day of Tauric's analyst consensus, so Marsad can
-- show how the rating counts and targets moved over time. Tauric serves only the current consensus, so the history
-- starts the day this table exists and grows with each `tauric-research` run. Kept by a trigger on
-- public.company_research, so the job needs no change and every analyst write is recorded exactly once per day
-- (a second write the same day replaces that day's row). Additive: one table, one function, one trigger.
create table public.analyst_history (
  ticker text not null check (ticker ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  as_of date not null,
  recommendation text,
  strong_buy integer check (strong_buy >= 0),
  buy integer check (buy >= 0),
  hold integer check (hold >= 0),
  sell integer check (sell >= 0),
  strong_sell integer check (strong_sell >= 0),
  number_of_analysts integer check (number_of_analysts >= 0),
  target_mean numeric,
  target_median numeric,
  target_high numeric,
  target_low numeric,
  refreshed_at timestamptz,
  recorded_at timestamptz not null default now(),
  primary key (ticker, as_of)
);

alter table public.analyst_history enable row level security;
create policy analyst_history_member_read on public.analyst_history
  for select to authenticated using (private.is_member());
revoke all on public.analyst_history from anon, authenticated;
grant select on public.analyst_history to authenticated;

-- Reads the validated analyst part as stored. A field that is missing or not a number stays null.
create function private.record_analyst_history() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  a jsonb := new.analyst;
  day date := ((coalesce(new.analyst_refreshed_at, new.fetched_at)) at time zone 'UTC')::date;
begin
  if a is null then
    return new;
  end if;
  insert into public.analyst_history (
    ticker, as_of, recommendation, strong_buy, buy, hold, sell, strong_sell, number_of_analysts,
    target_mean, target_median, target_high, target_low, refreshed_at
  ) values (
    new.ticker, day,
    case when jsonb_typeof(a -> 'recommendation') = 'string' then a ->> 'recommendation' end,
    case when jsonb_typeof(a -> 'strong_buy') = 'number' then (a ->> 'strong_buy')::integer end,
    case when jsonb_typeof(a -> 'buy') = 'number' then (a ->> 'buy')::integer end,
    case when jsonb_typeof(a -> 'hold') = 'number' then (a ->> 'hold')::integer end,
    case when jsonb_typeof(a -> 'sell') = 'number' then (a ->> 'sell')::integer end,
    case when jsonb_typeof(a -> 'strong_sell') = 'number' then (a ->> 'strong_sell')::integer end,
    case when jsonb_typeof(a -> 'number_of_analysts') = 'number' then (a ->> 'number_of_analysts')::integer end,
    case when jsonb_typeof(a -> 'target_mean_price') = 'number' then (a ->> 'target_mean_price')::numeric end,
    case when jsonb_typeof(a -> 'target_median_price') = 'number' then (a ->> 'target_median_price')::numeric end,
    case when jsonb_typeof(a -> 'target_high_price') = 'number' then (a ->> 'target_high_price')::numeric end,
    case when jsonb_typeof(a -> 'target_low_price') = 'number' then (a ->> 'target_low_price')::numeric end,
    new.analyst_refreshed_at
  )
  on conflict (ticker, as_of) do update set
    recommendation = excluded.recommendation, strong_buy = excluded.strong_buy, buy = excluded.buy,
    hold = excluded.hold, sell = excluded.sell, strong_sell = excluded.strong_sell,
    number_of_analysts = excluded.number_of_analysts, target_mean = excluded.target_mean,
    target_median = excluded.target_median, target_high = excluded.target_high, target_low = excluded.target_low,
    refreshed_at = excluded.refreshed_at, recorded_at = now();
  return new;
end;
$$;
revoke execute on function private.record_analyst_history() from public;

create trigger company_research_analyst_history
  after insert or update of analyst, analyst_refreshed_at on public.company_research
  for each row execute function private.record_analyst_history();
