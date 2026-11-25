-- Exposure and rotation (Phase 7, ADR 0022). Additive: each holding may name its sector ETF (for sector totals,
-- the sector shock and the rotation signal) and carries a thesis status Khaled sets (intact, weakening, broken).
-- Code never infers the thesis status; the rotation signal only suggests the ETF when he marks it weakening or broken.
alter table public.holdings
  add column sector_etf text check (
    sector_etf is null
    or sector_etf in ('XLK', 'XLF', 'XLE', 'XLV', 'XLI', 'XLY', 'XLP', 'XLU', 'XLB', 'XLRE', 'XLC')
  ),
  add column thesis_status text not null default 'intact' check (
    thesis_status in ('intact', 'weakening', 'broken')
  );
