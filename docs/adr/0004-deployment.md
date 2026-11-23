# ADR 0004: Deployment of web app, migrations and Edge Functions

- Status: accepted
- Date: 2026-11-23

## Context

The web app must deploy on every push to `main` with previews for branches. Migrations and Edge Functions must deploy reproducibly. Edge Functions must import `packages/core`, which lives outside `supabase/functions/`. The Supabase MCP connector can apply migrations and deploy functions from supplied files; the Supabase CLI can do both from GitHub Actions with an access token.

## Decision

- Web: Netlify continuous deployment from GitHub, configured by `netlify.toml` (build `pnpm --filter @marsad/web build`, publish `apps/web/dist`). Branches get deploy previews.
- Migrations: SQL files in `supabase/migrations/` are the source of truth. In Phase 0 they are applied through the Supabase MCP connector (`apply_migration`) after Khaled confirms the target organization and project, and only after the same files pass the PGlite tests in CI. From Phase 1, a manually triggered GitHub Actions workflow (`supabase db push`) becomes the standard path, using the secrets listed in docs/SETUP.md.
- Edge Functions: a build step copies `packages/core/src` into `supabase/functions/_shared/core/` (generated, git-ignored) before deploy, so every bundler (CLI or MCP) sees plain relative imports inside the functions directory. Phase 1 verifies this with the first real function and updates this ADR if the CLI's own bundling of out-of-tree imports proves reliable.

## Consequences

- No deployment path depends on a developer machine.
- The copied core is generated and never edited by hand; CI checks that functions type-check against it.
