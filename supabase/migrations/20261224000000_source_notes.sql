-- The seeded Status notes said "Adapter arrives in Phase 1". Every source except live Massive prices has had its
-- adapter since Phase 1; live prices wait for the Massive Stocks plan (Phase 5). Only rows still holding the seeded
-- note change; notes written by jobs are kept.

update public.source_status
  set note = 'Live prices start with the Massive Stocks plan (Phase 5); the end-of-day Massive feeds below are in use.'
  where source = 'massive' and note = 'Adapter arrives in Phase 1';

update public.source_status
  set note = null
  where source <> 'massive' and note = 'Adapter arrives in Phase 1';
