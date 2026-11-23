# ADR 0004: Deployment of web app, migrations and Edge Functions

- Status: accepted
- Date: 2026-11-23

## Context

The web app must deploy on every push to `main` with previews for branches. Migrations and Edge Functions must deploy reproducibly. Edge Functions must import `packages/core`, which lives outside `supabase/functions/`. The Supabase MCP connector can apply migrations and deploy functions from supplied files; the Supabase CLI can do both from GitHub Actions with an access token.

## Decision

- Web: Netlify continuous deployment from GitHub, configured by `netlify.toml` (build `pnpm --filter @marsad/web build`, publish `apps/web/dist`). Branches get deploy previews.
- Migrations: SQL files in `supabase/migrations/` are the source of truth. They are deployed by the Supabase GitHub integration ("Deploy to production", working directory `.`, production branch `main`), which applies new migrations when a change is merged to `main`. Supabase documents this as available on all plans; preview branches per pull request need Pro and are not used. CI runs every migration and the RLS tests on PGlite before merge, so a migration reaches production only after it passed offline.
- Migrations are never applied by hand or through the MCP connector as well, because a second path would record a different version in the migration history and the integration would then try to re-apply the same SQL. The connector is used for read-only verification (tables, policies, advisors) after each deploy, and for data writes Khaled approves (such as adding the owner to `private.app_owners`).
- Revision 2026-11-23: the first draft of this ADR applied Phase 0 migrations through the connector. Khaled linked the project to GitHub at creation, which made the integration the simpler path with no secrets.
- Edge Functions: the integration deploys only functions declared in `supabase/config.toml`, and bundling of `packages/core` from outside `supabase/functions/` is unverified. A build step therefore copies `packages/core/src` into `supabase/functions/_shared/core/` (generated, git-ignored) before deploy, so every bundler (CLI or MCP) sees plain relative imports inside the functions directory. Phase 1 verifies this with the first real function and updates this ADR if the CLI's own bundling of out-of-tree imports proves reliable.

## Consequences

- No deployment path depends on a developer machine.
- The copied core is generated and never edited by hand; CI checks that functions type-check against it.
