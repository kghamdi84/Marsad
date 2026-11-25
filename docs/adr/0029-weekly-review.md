# ADR 0029: The weekly review, from templates first

- Status: accepted
- Date: 2026-11-25
- Version: `weekly-review-1`

## Context

The brief asks for a weekly AI review (claude-opus-5-5) that covers behavior as well as results, including where Khaled broke his own rules. AI needs an Anthropic key and cost caps (Khaled's decision); integrity rule 18 says AI text falls back to templates.

## Decision

- Each Sunday after the export, the `weekly-review` job builds the review from templates: results (closed and opened trades, realized USD, mean R), behavior (mean adherence and the most-broken rules, named), the week's alerts by decision and Khaled's feedback, each rule's 5-session scorecard, and the regime. Code computes every number.
- Stored as a brief of kind `weekly-review` (the allowed kinds widened by migration) with its full inputs for replay; emailed through Resend when configured; shown on the Journal page. The Watch page keeps showing only the daily briefs.
- When the AI layer is enabled, Opus may add prose around this payload; its numbers are verified against the payload and the template stays the fallback.

## Consequences

- Checklist item 7.8 stays in progress until the AI prose exists.
