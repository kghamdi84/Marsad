-- Optional Shariah screening aid (Phase 8, ADR 0027): off by default; the basis and thresholds are Khaled's to set.
alter table public.user_settings
  add column shariah_screen boolean not null default false,
  add column shariah_basis text not null default 'market-cap'
    check (shariah_basis in ('market-cap', 'assets')),
  add column shariah_debt_max numeric(4, 3) not null default 0.330
    check (shariah_debt_max > 0 and shariah_debt_max < 1),
  add column shariah_cash_max numeric(4, 3) not null default 0.330
    check (shariah_cash_max > 0 and shariah_cash_max < 1);
