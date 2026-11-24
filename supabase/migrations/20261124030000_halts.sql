-- Nasdaq trade halts (Phase 1). Filled by the halts job; owner-readable with MFA.
-- One row per halt: a symbol can be halted more than once in a day, so the key includes the halt time.
create table public.halts (
  symbol text not null,
  halted_at timestamptz not null,
  name text,
  market text,
  reason_code text not null,
  reason_meaning text,
  news_related boolean not null default false,
  resumption_quote_at timestamptz,
  resumption_trade_at timestamptz,
  pause_threshold_price numeric,
  active boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (symbol, halted_at)
);
create index halts_halted_at_idx on public.halts (halted_at desc);
create index halts_active_idx on public.halts (active) where active;

alter table public.halts enable row level security;
create policy halts_owner_read on public.halts
  for select to authenticated using (private.is_app_owner());
revoke all on public.halts from anon, authenticated;
grant select on public.halts to authenticated;
