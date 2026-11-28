# ADR 0007: Where AI text is generated, and how it is kept honest

- Status: accepted; caps approved by Khaled on 2026-11-28 (addendum below)
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

## Addendum, 2026-11-28: caps approved, client wired

Khaled approved the proposed caps on 2026-11-28: **USD 1 a day and USD 10 a month** (UTC days and months), a warning at 80% of either, and the template at the cap. He adds the `ANTHROPIC_API_KEY` GitHub Actions secret himself.

- **One constant.** The caps live only in `AI_CAPS` in `packages/core/src/ai/cost.ts`, with the approval date in `AI_CAPS_APPROVED_ON`. A cap saved in Preferences can lower them, never raise them (`effectiveCaps`); a blank saved cap means the approved one. This replaces ADR 0028's rule that blank caps keep AI off: the switch is now the key.
- **Before every call** the job reads spend today and this month from `ai_usage`, adds the call's worst case (the prompt at three characters a token plus every output token `max_tokens` allows, `estimateCallUsd`) and calls only if that stays within both caps. At the cap the template is used and the run's details say why. At 80% the call is made and the warning goes in the run's details (`job_runs.details.budget`); the Status page shows the same spend from `ai_usage` against the same caps.
- **Every call is logged** in `ai_usage`: requested and served model, input, output, cache read and cache write tokens, USD (core's price table; a server-side fallback is priced per iteration at the model that ran it, and an unknown model at the dearest known price), prompt id and version, purpose and outcome (`text`, `max_tokens`, `refusal`, `invalid-json`, `unexpected-stop`, `api-error`).
- **Client.** `jobs/src/anthropic.ts` is the only file that imports `@anthropic-ai/sdk`. Each request sets the exact model id, `thinking: {type: "adaptive"}`, an explicit `output_config.effort`, `output_config.format` (one `text` field, so the versioned prompts are unchanged), the static system prompt with `cache_control`, and the server-side refusal fallback (`betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`). No sampling parameters, no tools, no forced `tool_choice`. The SDK's typed errors decide what is retried: a rejected key or malformed request ends the attempts; rate limits and connection errors get the grounded flow's one extra attempt.
- **Without the key** every AI job records `skipped` with `not configured (ANTHROPIC_API_KEY secret missing)`, never `ok`, and spends nothing; the weekly review keeps its template and says the same in its run details.

### What was built on it (checklist 2.9, 2.10, 7.8)

- **Storage.** `public.ai_outputs` (migration `20270110000000`) keeps every output: kind (`filing-summary`, `thesis-draft`, `weekly-review`), ticker or week, source ids and a source key, prompt id and version, requested and served model, the text shown, its citation records (id, label, sec.gov link, source, filing date), whether it passed the verifier, `model` or `template` with the fallback reason, every failed attempt with the rejected text, and the input snapshot. Members read filing summaries (shared research, ADR 0040); thesis drafts and weekly reviews are owner-only; nobody writes from the app.
- **Payloads** (`ai-payload-1`, `packages/core/src/ai/payloads.ts`): the newest quarter's figures from stored XBRL facts, the newest 10-Q and 10-K risk factor sections (cut at 20,000 characters, and the title says so), 8-K items of the last 120 days, and every date as a fact. The source key hashes the sources and the prompt version, so a company is summarized again only when a filing changes. The verifier now also checks ISO dates: a date must appear in a fact the sentence cites.
- **Jobs.** `ai-summaries` and `ai-thesis-drafts` run in `.github/workflows/ai-daily.yml` at 00:50 UTC Tuesday to Saturday (mirrored in Supabase Cron, `20270110000100`), at most 10 summaries and 5 drafts a run. Drafts are for open holdings without a saved thesis, or tickers asked for through the workflow's `thesis_for` input. The weekly review job adds `weekly-review@1` prose on Claude Opus 5.5 over the template's own figures (`weeklyReviewFacts`); the template review is written and sent either way.
- **Models and effort.** Summaries `claude-sonnet-5-5` at effort `low`, thesis drafts `claude-sonnet-5-5` at `medium`, the weekly review `claude-opus-5-5` at `medium`; `max_tokens` 8,000 each.
- **Pages.** Study's Filings view shows the summary labelled "AI summary (Claude), checked against the filing figures" with as-of date, model and linked sources, or the figures with the reason, or "No filing summary yet". The thesis card shows a verified draft labelled "AI draft, check before saving"; "Start from this draft" fills the form Khaled edits and saves himself (never saved automatically). The Journal's weekly review shows verified prose labelled "AI-written from the figures above" under the template figures.
- **Known limits.** The static system prompts are shorter than the smallest cacheable prefix, so `cache_control` is set but caching will rarely apply until a prompt grows; cache tokens are logged either way. Prices for the server-side fallback models come from the published table with assumed cache-read ratios.
