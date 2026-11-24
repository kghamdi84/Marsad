# Edge Functions

Deno functions deployed to Supabase. None exist yet: Phase 1 ingestion runs in GitHub Actions (docs/adr/0006-gpr-ingestion.md), and the first function arrives with the Phase 5 tick.

Functions import the shared engine from `./_shared/core/`, a generated copy of `packages/core/src` made by `node scripts/prepare-edge-core.mjs` (see docs/adr/0004-deployment.md). The copy is git-ignored. Never edit it by hand. CI type-checks it under Deno and requires the same results as Node.

Deploy with the manual workflow `deploy-functions.yml` once a function exists. It needs the repository secret `SUPABASE_ACCESS_TOKEN`.
