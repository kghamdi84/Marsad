-- The earnings guard (ADR 0052, ADR 0048 batch 5) stores its alerts under a kind of their own, `earnings`: a factual
-- calendar notice that makes no directional call, so the scorecard leaves it unscored. Widens the allowed kinds only;
-- every stored row keeps its kind. RLS on public.alerts is unchanged (owner-only read, no client writes).
alter table public.alerts drop constraint alerts_kind_check;
alter table public.alerts
  add constraint alerts_kind_check check (
    kind in (
      'setup',
      'opportunity',
      'options',
      'catalyst',
      'regime',
      'exit',
      'rotation',
      'halt',
      'earnings',
      'system'
    )
  );
