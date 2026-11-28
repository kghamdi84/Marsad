-- The app owner's limits, set by the council at Khaled's request on 28 Nov 2026 (ADR 0048, round 2 decision 3):
-- largest single position 20% of equity, top-5 share 60%, minimum cash 10%, maximum portfolio beta 1.5 and maximum
-- total open risk 6%. Stored as his own, labelled "Set by the council at your request on 28 Nov 2026; change any
-- time", and editable in Settings. Members get no row and start with "No limit set". Idempotent: a row that exists
-- (an owner who already saved limits) is left alone.
insert into public.portfolio_limits
  (owner_id, largest_position, top5, min_cash, portfolio_beta, open_risk, set_by, set_on)
select o.user_id, 0.2, 0.6, 0.1, 1.5, 0.06, 'council', date '2026-11-28'
from private.app_owners o
on conflict (owner_id) do nothing;
