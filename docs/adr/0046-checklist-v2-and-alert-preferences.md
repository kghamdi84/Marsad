# ADR 0046: Checklist version 2, alert preferences and holding horizon

Date: 2026-11-27. Status: accepted (Khaled: "add the second checklist for new trades").

## Context

The v2 design's pre-trade checklist has five different checks from the stored one: fits the current regime, stop
from structure, bear case and earnings date read, Shariah aid checked, order entered by hand in Sahm. The design's
Settings shows quiet hours and a daily push cap, which the alert pipeline already applied with fixed defaults.
Journal cards show a Long term or Swing horizon that holdings did not store.

## Decision

- **Checklist versions.** `checklist-2` holds the design's five checks; `checklist-1` keeps the original five.
  `trades.checklist_version` (default `checklist-1`, so every existing trade keeps its meaning) records which one a
  trade answered. New trades and the Sahm ticket use `checklist-2`. Adherence scores the items of the trade's own
  version; the six principles list items of both versions and only the answered ones apply. Old trades are never
  relabelled.
- **Alert preferences.** `public.alert_preferences` holds quiet hours and the daily push cap, one row, written only
  by the app owner (RLS with `private.is_app_owner()`), read by the alert jobs with the secret key. Without a row
  the pipeline defaults apply (23:00 to 07:00 Riyadh, 8 pushes). Critical alerts still bypass both. A table, not a
  security-definer function, because the schema guard forbids those in `public`.
- **Holding horizon.** `holdings.horizon` is nullable (`long` or `swing`), chosen under Edit holding, never inferred.

## Consequences

- Adherence for a checklist-2 trade can differ from a checklist-1 trade with the same ticks; each is scored against
  the checks it actually answered.
- Changing quiet hours or the cap affects the next alert run, not alerts already stored.
