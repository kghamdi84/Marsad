# ADR 0007: Where AI text is generated, and how it is kept honest

- Status: accepted (cost caps need Khaled's approval before the first paid call)
- Date: 2026-11-24

## Context

Phase 2 adds AI summaries of filings and a thesis card per company. The brief (in_app_ai, integrity rules 17 and 19) sets the rules: numbers come from data, never from the model; every claim cites source ids; untrusted text is wrapped in per-call random tags; a verifier checks every figure; one regeneration, then a deterministic template; every failure is logged; daily and monthly cost caps with a warning at 80% and a template fallback at the cap.

The browser holds only the publishable Supabase key, so it cannot hold an Anthropic key. Supabase Edge Functions are unverified on the platform (ADR 0004, item 5.2b) and need an access token. GitHub Actions already runs every Phase 1 job with secrets, and the brief asks for batches for overnight bulk summarization.

## Decision

- Generation runs in GitHub Actions (`jobs/`), on a schedule and on manual dispatch, for the watchlist tickers. Results are stored in the database and the web app only reads them. A later Edge Function can add on-demand refresh once 5.2b is verified.
- All grounding logic is pure code in `packages/core/src/ai/`: payload and facts, figure extraction, the verifier, generate-verify-retry-template orchestration, the untrusted-text wrapper, the template builder, and cost and budget math. The Anthropic client lives in `jobs/` and is injected, so every test runs offline and spends nothing.
- Payload ids: facts are `F1...`, documents `D1...`. A sentence is accepted only if it cites at least one valid id, every figure in it matches a numeric fact within the precision written, and that fact is one the sentence cites.
- Prompts are TypeScript modules in `packages/core/src/prompts/`, versioned by a `version` field and file name, each with a small evaluation set. The brief says `packages/core/prompts/`; the code lives under `src/` because core is pure TypeScript with no file access and is copied to Deno unchanged (ADR 0004). Each stored output records the prompt id and version.
- Models, by exact string: `claude-sonnet-5-5` for summaries and thesis cards, `claude-haiku-5-5` for high-volume classification, `claude-opus-5-5` for the weekly review in a later phase. No forced `tool_choice`, no sampling parameters and no disabled thinking (all rejected by these models); structured output through `output_config.format`; a `max_tokens` stop counts as a failure and is retried once; a `refusal` stop is a failure that goes to the template.
- Static prompt parts are cached with `cache_control`; the per-call random tag and notice go in the user turn after the documents so the system prompt keeps its cache prefix.
- Spend is computed from each response's usage fields with the price table in `ai/cost.ts` (copied from Anthropic's published table, to be re-checked) and stored per call. Proposed caps: USD 1 per day and USD 10 per month, warning at 80%, template fallback at the cap. Nothing is spent until Khaled approves caps and adds `ANTHROPIC_API_KEY`.

## Consequences

- A wrong figure never reaches the user: it is regenerated once, then replaced by code-built text. Failures are logged with the rejected text for audit.
- The verifier does not catch figures spelled as words, a sentence mixing rising and falling words, or a coincidence between two cited facts of the same unit and value. Prompts forbid spelled figures; the tests record these limits.
- AI text is not available on demand until an Edge Function path exists; it refreshes on the schedule or by manual dispatch.
