# Marsad: standing rules for Claude Code

Marsad (مرصد) is a private market-intelligence terminal for one user, Khaled. The full brief is `docs/BUILD_PROMPT.md`; this file condenses the rules that apply in every session. When they conflict, the brief wins.

## Start of every session

1. `pwd`, then read this file, `docs/PROGRESS.md`, `docs/phase-checklist.json` and `git log --oneline -15`.
2. Run `./init.sh` (install, typecheck, lint, tests) before changing anything.
3. Write one line saying what you are about to do before the first tool call.

## What Marsad is and is not

- It watches, researches, explains and alerts. Khaled decides and places every order by hand in Sahm (a broker with no API). No order-placement code, no brokerage credentials, ever.
- Never present holding a position as the default. Every position and idea has explicit exit conditions and a bear case.
- Accuracy over features: "data unavailable" beats a wrong number.

## Accounts (billing and ownership)

- Use only Khaled's personal Supabase organization and personal Netlify team named in `docs/SETUP.md`. The "Gulf Insulation Group" Supabase organization is work: never touch it. The Netlify team "GIG" (`khaled-alghamdi-84`) is confirmed personal; Marsad's site is `marsad-k84`.
- Before creating anything in Supabase or Netlify, show the organization or team and wait for confirmation.

## Ask before (risky steps)

Anything that costs money (paid plans, paid data, upgrades); deleting data or tables; destructive migrations; force-pushing; changing production auth or secrets; sending messages anywhere except Khaled's own channels. For technical choices, pick a sensible default, write an ADR in `docs/adr/`, and continue.

## Integrity rules (short form; full list in the brief)

1. Provenance on every number: source, endpoint, as-of time, plan tier, formula version for derived values.
2. Freshness states live, delayed, stale, unavailable, with text labels; thresholds depend on session state. Silence never looks like calm.
3. One calculation engine: `packages/core` is pure TypeScript (no DOM, Node or Deno APIs; its tsconfig enforces this) and is shared by web, Edge Functions and jobs.
4. Known-answer tests for every indicator and formula, against a reference implementation or hand-checked data, with a stated tolerance.
5. Cross-source checks and nightly reconciliation; disagreements raise system alerts.
6. Bad-print and corporate-action guards; check splits and ticker events before alerting on moves above 25%.
7. Timestamps are UTC `timestamptz`; convert vendor ms/ns through tested helpers; show ET next to local time (default Asia/Riyadh).
8. Identity by CIK and FIGI, not ticker.
9. Point-in-time research: no look-ahead, no survivorship bias, realistic costs.
10. Statistical honesty: bootstrap 90% intervals, walk-forward with untouched holdout, trial counts and deflated Sharpe, benchmark and regime breakdown. No percentage from fewer than 30 cases.
11. Rule lifecycle draft, backtested, shadow, live, demoted; live rules are immutable, edits create versions.
12. Every alert stores its input snapshot and rule version; replay reproduces it.
13. No silent failures: every job writes `public.job_runs`; stale feeds pause dependent rules and send a system alert.
14. Source tiers 1 to 4; news clustered; opinion labeled. 15. Disclosure lags labeled.
15. Risk percentages per horizon with n and a 90% Wilson interval, or "insufficient history".
16. AI explains, code decides and calculates. Numbers in AI text are verified against the payload; failure falls back to templates. Untrusted text is wrapped in per-call random-ID tags.
17. Security: RLS on every table (personal tables `owner_id = auth.uid()`, system tables owner-only), all policies require an aal2 (MFA) session (temporarily relaxed to password sign-in at Khaled's request, ADR 0039; restore before the platform is final), sign-ups open to friends as members who read shared tables only (ADR 0040), only the publishable key in the browser, strict CSP and noindex.
18. Cost caps with 80% warnings; AI falls back to templates at the cap.

## Engineering

- pnpm workspaces; TypeScript strict (pinned to 6.0.x, see ADR 0001); ESLint, Prettier, Vitest, Playwright; PGlite runs migrations and RLS tests offline.
- Every new table: RLS enabled, policies requiring `private.is_mfa()`, no grants to `anon`. The schema-guard tests fail otherwise.
- Prices as `numeric`; time-series indexed by ticker and time; migrations additive by default.
- Secrets only in Supabase secrets, Netlify env vars and GitHub Actions secrets. `.env.example` lists names only. Never ask for a secret in chat.
- Before any Massive adapter: confirm endpoint, parameters and fields with the Massive MCP `search_endpoints` tool and save a real response (keys stripped) under `fixtures/`.
- Every change that can run is checked by running it (tests, typecheck, build). Say so when a check could not run.
- Tests define correctness for financial math. If a test looks wrong, explain and ask before changing it.
- Build only the current phase. Ideas for later go to `docs/IDEAS.md`. Abstractions only when two places use them.
- After each checklist item: commit (conventional message), update `docs/PROGRESS.md` and the item's status and evidence in `docs/phase-checklist.json`.
- Remove temporary files you created. Commit and update PROGRESS.md before context runs low.

## Writing style

- Google developer documentation style; Apple Style Guide verbs (tap, click, press, choose, select) and inclusive terms (allow list, deny list).
- No em dashes anywhere (copy, docs, comments, generated text). Use commas, colons or parentheses.
- All UI strings in `apps/web/src/strings.ts`; logical CSS properties (start/end) for future right-to-left support.
- Design: calm dark terminal, IBM Plex Sans with tabular figures, blue up and orange down plus sign and arrow (color never the only signal), touch targets at least 44 points, minimal motion.

## Phase report (Khaled reads it on an iPad, about 15 lines)

What is live and where; how it was verified (commands and results); what to tap to test it; what Khaled must do (accounts, payments, secrets); open decisions; model and effort for the next phase.
