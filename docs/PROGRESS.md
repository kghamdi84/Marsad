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
5. Done: Khaled confirmed Netlify team "GIG" (`khaled-alghamdi-84`) is personal. Claude created site `marsad-k84` (id `c8eb3a9d-8c02-4bba-818e-1970923ca7ea`, `https://marsad-k84.netlify.app`) and set `VITE_SUPABASE_URL`. Note: the same team also hosts Gulf Insulation sites (giginsulation.app); Khaled decided it is personal.
6. Done: Khaled linked the Netlify site to GitHub `main` (build `pnpm --filter @marsad/web build`, publish `apps/web/dist`). The first deploy of `main@f70e132` (README only) failed as expected.
7. Next session: read the publishable key with the Supabase connector (`get_publishable_keys`) and set `VITE_SUPABASE_PUBLISHABLE_KEY` on the Netlify site.

### Merged and deployed (2026-11-23)

- PR #1 merged into `main` as `c75df75` at Khaled's request.
- Netlify production deploy of `main` is live at `https://marsad-k84.netlify.app` (HTTP 200, CSP and `X-Robots-Tag: noindex` present). It shows "Configuration missing" until `VITE_SUPABASE_PUBLISHABLE_KEY` is set.
- The Supabase GitHub integration should have applied `20261123000000_baseline.sql` on the merge. Not yet verified: this session's connector cannot see the project.
- Khaled reported Supabase Auth set up ("Supabase signed in"), but has not yet confirmed each of the five settings (sign-ups off, TOTP on, token email template, owner user confirmed, Site URL). Re-check them in the next session.

### Live checks with the publishable key (2026-11-23, after the merge)

- Khaled shared the publishable key; Claude validated it against `/auth/v1/settings` (HTTP 200; a variant with a capital I instead of lowercase l returns 401) and set `VITE_SUPABASE_PUBLISHABLE_KEY` on Netlify. It takes effect on the next deploy.
- `/auth/v1/settings` reports `disable_signup: false`: **sign-ups are still on** in the live project. Khaled must turn them off (SETUP step 2.1).
- REST requests for `job_runs`, `source_status`, `user_settings` and `watchlists` return 404 "Could not find the table": **the GitHub integration did not apply the baseline migration** on the merge of PR #1.
- Likely cause (unconfirmed): no `supabase/config.toml`, which the Supabase CLI uses to recognise the project directory. Added one, generated with `supabase init` (CLI 3.3.0) and set to Marsad's values. Khaled should also check the integration's deploy log.
- How to verify without the connector: anon REST on `job_runs` returns 404 while the table is missing and 401 or 403 (permission denied) once the migration has run, because anon has no grants.

### Auth findings while Khaled configured Supabase (2026-11-23)

- Sign-ups now off: live `/auth/v1/settings` reports `disable_signup: true`. Confirm email on. TOTP shows Enabled in the dashboard (not verifiable from outside; the sign-in test proves it).
- Email templates cannot be edited on Free without custom SMTP; the default email has a link, not a code. The web app now accepts the link through PKCE (ADR 0005 revision), with a new e2e test of the full link exchange.
- Khaled nearly created an Auth "Send Email hook" pointing at the Netlify site, which would have stopped all auth emails; he was told to cancel it. Next session: confirm Auth Hooks lists nothing enabled.
- No user existed yet (dashboard Users list empty); Khaled is creating it.

### Next steps after unblock

1. Khaled merges PR #1; the GitHub integration applies the baseline migration. Never also apply it through the connector (ADR 0004).
2. Verify through the connector: tables, RLS, policies, migration history, advisors. With Khaled's approval, add his user id to `private.app_owners`.
3. Set `VITE_SUPABASE_PUBLISHABLE_KEY`, trigger a deploy, confirm headers on `https://marsad-k84.netlify.app` (CSP `connect-src` is pinned to `hwdwivilqdydmxhycapy.supabase.co`).
4. Khaled signs in with email code and TOTP; mark Phase 0 done.

### Notes for the next session

- Deploy preview `https://deploy-preview-1--marsad-k84.netlify.app` (2026-11-23): built on Netlify; live headers verified (CSP pinned to the project host, `X-Robots-Tag: noindex`, Referrer-Policy, Permissions-Policy, HSTS, X-Frame-Options); SPA deep link `/status` returns 200; `robots.txt` disallows all. Page showed "Configuration missing" as expected (no publishable key yet).
- On deploy previews the browser logs two CSP violations from Netlify's injected review drawer (an inline style and a frame of app.netlify.com). The same build served locally under the same CSP logs none, so they are Netlify's, not Marsad's. Production deploys do not inject the drawer. Optional: turn the drawer off in Netlify (Deploy settings, Deploy Previews, Netlify Drawer).

- TypeScript is pinned to 6.0.x because typescript-eslint does not support 7.x yet (ADR 0001).
- PGlite has one connection: never call `db.query` from inside a `db.transaction` in tests (it deadlocks).
- Playwright uses the preinstalled Chromium at `/opt/pw-browsers/chromium` in cloud sessions; CI installs its own.
