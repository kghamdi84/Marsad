-- checklist-2 (Marsad v2 design, Khaled's choice 2026-11-27): new trades answer the design's five checks (fits the
-- regime, stop from structure, bear case and earnings date, Shariah aid, entered by hand in Sahm). They are
-- different checks from checklist-1, so each trade records which version it answered and is never relabelled.
-- Additive: existing rows keep checklist-1 through the default; the app writes checklist-2 for new trades.
alter table public.trades
  add column checklist_version text not null default 'checklist-1'
    check (checklist_version in ('checklist-1', 'checklist-2'));
