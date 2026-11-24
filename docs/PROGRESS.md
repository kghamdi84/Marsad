# Progress

## Current phase: 1, Data and trust layer (in progress). Phase 0 follow-ups still open, see below.

Last updated 2026-11-23 (Phase 1 session 1).

### Phase 1 session 1 (2026-11-23): what exists

Pure core (`packages/core`, 138 tests): timestamps (s/ms/us/ns), market calendar and session state (recorded Massive holidays), provenance and session-aware freshness, indicators (pandas golden values at 1e-9, mutation-checked), Nasdaq halts and GPR parsers (recorded fixtures), HTTP layer (token bucket, cache, retry, entitlement classification), identity and splits (vendor adjustment factors reproduced), feed health with transition-only system alerts, job run wrapper, Massive/FRED/SEC adapters, cross-source reconciliation.

Database (additive migrations, RLS tested, 16 tests): instruments, instrument_tickers, splits, market_holidays, gpr_daily.

Jobs: `jobs/` runs the GPR job (download, convert with `xlrd`, validate, upsert, run record, source status). Dry-run on the real file: 15,302 days, none skipped, 0.5 s. Workflow `.github/workflows/gpr-daily.yml` needs the secrets `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (SETUP step 5). Not yet run against the live project.

Web: Status page judges each source with the core policy and says why in words.

### Verified live (2026-11-24)

- PR #5 merged (`539b1ee`); the GitHub integration created `instruments`, `instrument_tickers`, `splits`, `market_holidays` and `gpr_daily` within about 30 seconds (anon REST returns 401 on each).
- First two GPR runs failed for two reasons found from the job logs: `SUPABASE_SECRET_KEY` secret missing, then `SUPABASE_URL` secret not a valid URL (re-entered by Khaled). Third run succeeded: `gpr-daily: ok, rows 15302, 22115 ms`.
- Khaled's Status page screenshot (2026-11-24 11:14 ET) shows: Geopolitical Risk Index "OK, last message 1m 6s ago (limit 4d 0h)", plan tier end-of-day, latency 21481 ms, note "Latest value 2026-11-23"; job run `gpr-daily` OK with 15302 rows. FRED shows "No data received yet"; Massive, Nasdaq halts and SEC show "Calendar not loaded, cannot judge", which is the intended behaviour until the calendar job fills `market_holidays` (needs the Massive key). This closes the Phase 0 follow-up "Status page screenshot".
- Tooling note: Claude cannot read or set GitHub secrets (the proxy blocks that API, correctly); everything else on Actions, including starting workflows and reading logs, works from a session.

### FRED job (2026-11-24, awaiting merge and first live run)

`jobs/src/fred-job.ts` fetches all 12 FRED series from 1990 and stores them in `fred_observations` (new migration), one run record per run, source status live only when every series succeeded. Workflow `.github/workflows/fred-daily.yml` (23:30 UTC daily) needs the secret `FRED_API_KEY` (Khaled added it; Claude cannot read secrets, so the first run proves it). Tests use synthetic FRED bodies; the first live run logs the newest three values of each series (public numbers) so real values can be checked and a real fixture recorded.

### Massive jobs (2026-11-24, awaiting merge and first live runs)

- `jobs/src/massive-reference-job.ts`: market holiday calendar (`market_holidays`) and split history (`splits`) for the 10 watchlist names and SPY, QQQ, IWM, DIA; run at 05:30 UTC by `massive-reference.yml`. Uses its own source row `massive_reference` (daily limit), so the Status page does not judge it by the live-price limit. A plan problem is reported as "Requires a higher Massive plan".
- `jobs/src/reconcile-job.ts`: nightly check of Massive Treasury yields against FRED (10-year, 10y-3m and 10y-2y spreads) for every date both published; mismatch, or nothing to compare, fails the run (`reconcile-nightly.yml`, 00:45 UTC).
- Adapter `fetchTreasuryYields` and a recorded fixture `fixtures/massive/treasury-yields.json`. Tests (jobs 14, core 141) use the recorded Massive rows.
- Unconfirmed until the first live runs: Massive base URL (`https://api.massive.com`), the REST envelope, and the entitlement error body. The first run's log shows any of these failing, and `docs/DATA_SOURCES.md` gets updated from it.

### What is NOT done in Phase 1

- Live recording of Massive, FRED and SEC responses: no keys and no SEC contact string yet. FRED and SEC tests use labelled synthetic bodies. The Massive entitlement error body and base URL are unconfirmed against the live REST API.
- No deployed adapters, no Edge Functions, no scheduled halts polling, no nightly reconciliation job, no heartbeat job (item 1.14 untouched: Edge Function core bundling and a Supabase CLI deploy path remain unverified; this machine has no Docker or Deno).
- Nasdaq halts terms of use are unconfirmed (Khaled to review).
- The Phase 0 follow-ups (advisors, `list_migrations`, Auth Hooks empty, Status screenshot) need a session whose Supabase connector sees the project.

### Done (Phase 0)

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

### Root causes found 2026-11-23 (after PR #2 merged)

- Migration not applied: the Supabase GitHub integration had **Deploy to production switched off** (Khaled's screenshot of Project Settings, Integrations). Working directory `.` and repository were correct. Khaled is turning it on with production branch `main`. The next push to `main` should apply `20261123000000_baseline.sql`; verify with anon REST on `job_runs` (404 means missing, 401 or 403 means present).
- "Configuration missing" on Khaled's iPad while the live site served the sign-in screen: the PWA service worker used `registerType: 'prompt'` with no prompt UI, so a waiting worker kept serving the first (keyless) build. Switched to `autoUpdate` with `skipWaiting`, `clientsClaim` and `cleanupOutdatedCaches`.

### Sign-in verified (2026-11-23 18:33 UTC)

- Khaled signed in at `https://marsad-k84.netlify.app` on his iPad with the emailed link and TOTP enrollment, and reached the Watch tab (screenshot: clock 13:33 ET, 21:33 local). The shell renders only at aal2, so this proves email sign-in plus MFA end to end. Phase 0 done criterion 1 is met.
- Supabase "Deploy to production" is now on (branch `main`), confirmed by Khaled's screenshot.

### Migration applied and owner added (2026-11-23 18:36 UTC)

- With Deploy to production on, merging PR #3 (`c83df4b`) applied `20261123000000_baseline.sql` within about 30 seconds.
- Live check with the publishable key (anon role): `job_runs`, `source_status`, `user_settings`, `watchlists` and `watchlist_items` all return 401 `permission denied` (42501). The tables exist and anon has no access, as designed.
- Khaled added his user (`eb05aa71-5d03-498f-a557-3d9fe8c23330`) to `private.app_owners` in the SQL Editor (insert guarded by "exactly one user exists"; returned 1 row).

### Phase 0 follow-ups for the next session (do these first)

1. With the Supabase connector (connectors load at session start): confirm `list_projects` shows `hwdwivilqdydmxhycapy`; run `get_advisors` (security and performance) and fix anything open; `list_migrations` should show `20261123000000`; confirm Auth Hooks has nothing enabled.
2. Done 2026-11-24: Status page screenshot received (see Verified live).

### Earlier plan (kept for history)

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
