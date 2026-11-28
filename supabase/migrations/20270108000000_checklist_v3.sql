-- checklist-3 (ADR 0048 round 2, decided by the council at Khaled's request on 2026-11-28): checklist-2's five checks
-- plus checklist-1's "risk defined" and "profit plan". New trades answer it; trades already logged keep the version
-- they answered and are never relabelled (ADR 0046).
-- Additive: the check on trades.checklist_version is widened to allow 'checklist-3'; no row changes. The default stays
-- 'checklist-1' (it marks rows written before versions existed); the app writes the version of every new trade.
alter table public.trades drop constraint trades_checklist_version_check;
alter table public.trades
  add constraint trades_checklist_version_check
    check (checklist_version in ('checklist-1', 'checklist-2', 'checklist-3'));
