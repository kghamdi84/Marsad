-- The weekly review (Phase 7, ADR 0029) is stored as a brief of its own kind. Widens the allowed kinds only.
alter table public.briefs drop constraint briefs_kind_check;
alter table public.briefs
  add constraint briefs_kind_check check (kind in ('pre-market', 'close-recap', 'weekly-review'));
