-- Holding horizon on the Journal position cards (Marsad v2): Long term or Swing, chosen by the owner, never inferred.
-- Additive and nullable: existing holdings show no horizon pill until one is chosen under Edit holding.
alter table public.holdings
  add column horizon text check (horizon is null or horizon in ('long', 'swing'));
