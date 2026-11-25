# ADR 0025: The thesis card, written first and drafted by AI later

- Status: accepted
- Date: 2026-11-25
- Version: `thesis-1`

## Context

The brief's thesis card is AI-written from cited sources: bull case, bear case (required), key risks, and what would change the view. The AI items wait for an Anthropic key and cost caps (Khaled's decision). The card's main job, putting the other side of every idea in writing before it is held, does not need AI.

## Decision

- A personal, append-only `theses` table: each save is a new version, so the history of a view and the moment it turned are kept. No update or delete grant.
- The bear case and "what would change my view" are required by the app (`validateThesis`) and by the database (at least 40 characters each, a real sentence rather than a placeholder); at least one risk; sources must be https links.
- The card sits on each company page. Saving a version also sets the same status on any open holding of that ticker, so the rotation signal (ADR 0022) reads the current view.
- When the AI layer is enabled, its draft will fill the same fields from cited filings and news, with numbers verified against the payload and the bear case still required; Khaled saves it as a version like any other.

## Consequences

- Checklist item 2.10 stays in progress until the AI draft exists.
