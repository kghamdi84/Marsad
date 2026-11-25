# ADR 0030: The catalyst watch on end-of-day data

- Status: accepted
- Date: 2026-11-25
- Version: `catalyst-1`

## Context

The brief's catalyst watch: Khaled writes scenarios in advance (name, entities, triggers such as 8-K items, Form 4 codes, news with a minimum source tier, halts, and price and volume conditions; a confirmation rule; a written plan with a chase guard, invalidation and size; an expiry). Critical priority needs a tier-1 source or two independent tier-2 sources; otherwise the alert is unconfirmed. Each match shows its historical analogs with their count. Live, minute-by-minute matching needs the Phase 5 data plans, which are Khaled's decision.

## Decision

- **Scenarios**: a personal table `catalyst_scenarios` (MFA), written on the Alerts page. The database refuses a scenario without a trigger, a plan entry, an invalidation or a chase guard between 0% and 100%. Scenarios can be paused and expire on their date.
- **Matching** (`catalyst.ts`): each evening after the bars job, the `catalyst-watch` job matches every active scenario against the last 26 hours of stored 8-Ks (items), Form 4s (transaction codes), news (headline keywords, publisher tier at or better than the scenario's minimum) and halts, and the session's close-to-close move with volume against its 20-session average.
- **Confirmation**: confirmed when any source is tier 1 (an SEC filing or an exchange halt notice) or two tier-2 sources come from different publishers (one wire counted once). Confirmed matches are critical, others high and labeled "unconfirmed" with the reason.
- **Chase guard**: applied in the plan text, not as a pipeline gate, so a chased catalyst is still shown with "No entry: the move is beyond the guard", as the brief's example does.
- **Analogs**: the count of stored 8-Ks with the scenario's items for the ticker, shown in the bear case; under 30 the alert says the history is insufficient for a rate.
- **Shadow until live data**: matches go through the pipeline as shadow alerts (recorded and scored, not pushed), with a 26-hour freshness limit and the delayed label, because end-of-day matching cannot meet the timing a live catalyst needs.
- The alert plan's stop and targets became optional: a written plan has no price level, and the card leaves those lines out; the scorecard scores stop or target first only for plans that have them.

## Consequences

- When the Phase 5 feeds exist, the same matcher runs on live events and the scenarios can be promoted from shadow to live.
- Intraday plan conditions (a 5-minute range break holding VWAP) are shown as Khaled wrote them; code does not evaluate them on daily bars.
