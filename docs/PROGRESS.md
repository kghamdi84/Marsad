# Progress

## Current phase: 0, Foundations (in progress, blocked on account decisions)

Last updated 2026-11-23.

### Done

- Docs: SETUP.md, ARCHITECTURE.md, DATA_SOURCES.md, IDEAS.md, ADRs 0001 to 0005, CLAUDE.md, BUILD_PROMPT.md (the brief, saved verbatim).
- pnpm monorepo: `apps/web`, `packages/core`, `supabase`, `jobs`, `fixtures`.
- `packages/core`: time helpers (ET and local clock through the IANA database) with DST tests.
- Database baseline migration: personal tables (`user_settings`, `watchlists`, `watchlist_items`) and system tables (`job_runs`, `source_status`), RLS on all, every policy requires an MFA (aal2) session, anon has no grants.
- RLS tests on PGlite (14 tests): another user cannot read, change, delete or insert the owner's rows; aal1 and anon read nothing; non-owners read no system rows; schema guards. A deliberate policy mutation made 5 tests fail, so the suite is not vacuous.
- Web app: email code sign-in (`shouldCreateUser: false`), TOTP enrollment and challenge, aal2 gate, shell with bottom tab bar and ET/local clock, status page skeleton, PWA manifest and icons, strict CSP and noindex headers.
- Playwright: 5 smoke tests (signed-out screen, no user creation, error text, aal1 sent to MFA, aal2 sees shell and status page).
- CI workflow (typecheck, lint, format, tests, build, Playwright): green on GitHub, run 45225834635.

### Blocked on Khaled (see docs/SETUP.md)

1. Done by Khaled: Supabase org **Personal Projects** (Free) and project `hwdwivilqdydmxhycapy` (Tokyo), linked to this repository.
2. Done by Khaled: Supabase connector reconnected with **Personal Projects**. Connectors load at session start, so the session that started Phase 0 still could not see the project (`get_project` returned a permission error). Verify access first thing in the next session with `list_projects`.
3. Done by Khaled: GitHub integration settings checked (working directory `.`, branch `main`, Deploy to production on).
4. Step 2: Auth settings (sign-ups off, TOTP on, code email template) and the owner user.
5. Step 3: is Netlify team "GIG" (`khaled-alghamdi-84`) personal?

### Next steps after unblock

1. Khaled merges PR #1; the GitHub integration applies the baseline migration. Never also apply it through the connector (ADR 0004).
2. Verify through the connector: tables, RLS, policies, migration history, advisors. With Khaled's approval, add his user id to `private.app_owners`.
3. Create the Netlify site from GitHub with the two `VITE_` variables; confirm headers on the live URL. CSP `connect-src` is already pinned to `hwdwivilqdydmxhycapy.supabase.co`.
4. Khaled signs in with email code and TOTP; mark Phase 0 done.

### Notes for the next session

- TypeScript is pinned to 6.0.x because typescript-eslint does not support 7.x yet (ADR 0001).
- PGlite has one connection: never call `db.query` from inside a `db.transaction` in tests (it deadlocks).
- Playwright uses the preinstalled Chromium at `/opt/pw-browsers/chromium` in cloud sessions; CI installs its own.
