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

## Verification, 2026-11-24 (checklist item 1.14)

What was checked by running it, with Deno 2.9.6:

- The unchanged core fails under Deno: `Module not found ".../time.js"`. Core imports are written for Node and TypeScript (`./time.js` names the compiled file), and Deno resolves exact file names.
- `scripts/prepare-edge-core.mjs` copies `packages/core/src` (tests left out) to `supabase/functions/_shared/core` and rewrites relative `.js` imports to `.ts` (18 files, 43 imports). The script fails if any `.js` import is left over.
- `deno check` on the copy passes in strict mode, so core uses no Node-only API.
- `scripts/edge-parity.mjs` runs indicators, session logic, source-health evaluation and ET conversion from the Node source and from the Deno copy: the output is byte-identical (9,295 bytes). CI runs this on every pull request (job `edge-core`).

Not verified: bundling by Supabase's own deploy (CLI or connector) on the platform. That needs a Supabase access token and a first real function, and no Edge Function exists yet (ingestion runs in GitHub Actions, ADR 0006). The deploy workflow `deploy-functions.yml` is manual and does nothing until a function exists. The first deploy in Phase 5 is where this is confirmed, and this ADR will be updated then.
