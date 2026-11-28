# Edge Functions

Deno functions deployed to Supabase. Ingestion and AI jobs run in GitHub Actions (docs/adr/0006-gpr-ingestion.md, docs/adr/0007-ai-generation.md); functions are for what must answer a signed-in person on demand.

| Function | What it does                                                                                                                          | Secrets it reads                                                                                                    | ADR  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---- |
| `ask`    | Answers the owner's question with Claude Sonnet 5.5 through read-only tools over Marsad's tables, checks every figure, cites sources. | `ANTHROPIC_API_KEY` (added by Khaled); `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (built in). | 0054 |

Functions import the shared engine as `@marsad/core`, which each function's `deno.json` maps to `../_shared/core/index.ts`, a generated copy of `packages/core/src` made by `node scripts/prepare-edge-core.mjs` (see docs/adr/0004-deployment.md). The copy is git-ignored. Never edit it by hand. Under Vitest and `tsc`, the same name resolves to the workspace package, so the handler's tests run on Node against the source. CI type-checks the copy and the `ask` function under Deno.

Each function keeps its Deno-free logic in `handler.ts` (tested in `supabase/tests/`) and its wiring in `index.ts`.

Deploy with the manual workflow `deploy-functions.yml` (Actions, **Deploy Edge Functions**, **Run workflow**, function `ask`). It needs the repository secret `SUPABASE_ACCESS_TOKEN`.
