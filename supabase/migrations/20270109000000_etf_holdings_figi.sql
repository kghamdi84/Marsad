-- Composite FIGI per ETF holding (ADR 0038 addendum, etf-3, openfigi-2): identity by FIGI, not ticker. Filled by the
-- ETF job from OpenFIGI's mapping of each holding's CUSIP (or ISIN where it has no CUSIP); null where OpenFIGI gave
-- no single US equity listing or the match came from the company name. Additive: one nullable column with a format
-- check; the table's row-level security and grants are unchanged.
alter table public.etf_holdings
  add column figi text check (figi is null or figi ~ '^BBG[0-9A-Z]{9}$');
create index etf_holdings_figi_idx on public.etf_holdings (figi) where figi is not null;
