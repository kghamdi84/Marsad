# ADR 0028: The cost tracker and AI caps

- Status: accepted
- Date: 2026-11-25
- Version: `costs-1`

## Context

Integrity rule 18: cost caps with 80% warnings; AI falls back to templates at the cap. Phase 8 asks for a cost tracker. Today every service runs on a free or public plan, and no Anthropic key is set.

## Decision

- **Plans**: a list of each service, its plan and its monthly cost (all USD 0 today), with what upgrading would mean (Supabase Pro USD 25 a month is a Phase 5 prerequisite). Changing a plan is Khaled's decision; the list changes with it.
- **AI spend**: every Claude call records its job, purpose, model, token usage, cost (from `costOfUsage`) and whether it fell back, in the system table `ai_usage`. The Status page shows spend today and this month (UTC) by model against Khaled's daily and monthly caps, using the existing `evaluateBudget` (warning at 80%, capped at 100%).
- **Caps are opt-in**: the caps live in `user_settings` and are blank by default. While either is blank, AI stays off and text comes from templates; the page says so.
- **GitHub Actions**: minutes this month estimated from `job_runs` (each run rounded up to a whole minute), labeled a lower bound because workflow setup is not logged.

## Consequences

- When the AI layer lands, each call must write `ai_usage` and check the budget before calling; the tests for that come with it.
