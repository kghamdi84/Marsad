# ADR 0008: Reliable scheduling for the polling jobs

- Status: accepted (Khaled, 2026-11-26), option 2; built in migration `20261229000000_scheduler.sql`
- Date: 2026-11-24

## Context

Every Phase 1 and Phase 2 job runs from a GitHub Actions `schedule` trigger (ADR 0003, ADR 0006). On 2026-11-24 the heartbeat raised two real alerts, `nasdaq_halts` and `sec_edgar` stale during the regular session, and checking the run history showed why: **the scheduler has hardly fired at all.**

Measured on 2026-11-24 (all times UTC, repository `kghamdi84/Marsad`):

| Workflow     | Cron                     | Expected runs by 19:00 since it reached `main`     | Scheduled runs that fired     |
| ------------ | ------------------------ | -------------------------------------------------- | ----------------------------- |
| Nasdaq halts | every 5 minutes, 07:00+  | about 20 (merged 17:11)                            | 0                             |
| Heartbeat    | every 15 minutes, 08:00+ | about 6 (merged 17:34)                             | 0                             |
| SEC filings  | twice an hour, 11:07+    | 4 (merged 17:03: slots 17:07, 17:37, 18:07, 18:37) | 0                             |
| GPR daily    | 06:17 daily              | 1                                                  | 1, at 17:50 (11.5 hours late) |

In the whole repository `GET /actions/runs?event=schedule` returns one run. Every other run so far was started by hand (`workflow_dispatch`), which starts within seconds and has never failed to start. GitHub's documentation says scheduled runs are best-effort and can be delayed or dropped under load; this repository shows the extreme case. Earlier phase reports described these jobs as running "every 5 minutes" and "every 30 minutes". Only the jobs themselves were verified, by manual runs; no scheduled run had been observed. That claim was not verified and is withdrawn.

The heartbeat does its job: it reported the silence. But the heartbeat is itself scheduled, so if the scheduler stays silent, nothing raises an alert either, except the Status page, which judges freshness in the browser from each source's last message time and so does not depend on the heartbeat running. (The page also shows how long ago the heartbeat last ran.)

## Options

1. **Keep GitHub schedules and relax the limits.** Free, no new secrets. Rejected as the main answer: the limits would have to allow many hours of silence, which defeats the heartbeat.
2. **Supabase Cron (`pg_cron`) calls GitHub's `workflow_dispatch` API through `pg_net`.** The Supabase documentation (Cron quickstart, pg_net, Scheduling Edge Functions) describes `pg_cron` for recurring jobs, including sub-minute intervals, `pg_net` for HTTPS requests from SQL, and Vault for the credential. The jobs stay in GitHub Actions, only the trigger moves to a scheduler that is part of the project's own database. Needs a fine-grained GitHub token with **Actions: Read and write on this one repository** (Khaled creates it; stored only in Supabase Vault). Whether Supabase Cron and `pg_net` are enabled on the Free plan has to be confirmed in the dashboard (Database, Extensions).
3. **Supabase Cron calls Edge Functions that do the work.** This is the Phase 5 design (the tick fan-out). It removes GitHub from the path but needs the Edge Function deploy path verified first (item 5.2b) and per-function time limits checked. Too much for the current need.
4. **An external cron service calling the same API.** Same token need as option 2, plus a third-party account.

## Recommendation

Option 2 now, option 3 when Phase 5 builds the tick. It costs nothing, keeps every credential inside accounts Khaled already owns, and keeps the proven Actions jobs. Each job keeps its own schedule as a backup (a duplicate trigger is harmless because every job is idempotent and each workflow has a concurrency group).

## What changes when accepted

- A migration enables `pg_cron` and `pg_net`, creates the Vault secret slot and one function that dispatches a named workflow; one cron entry per job mirrors today's schedules.
- The heartbeat gets a second trigger from the same scheduler, plus a Status line that goes red when the heartbeat has not run for 30 minutes during a session.
- Phase 1 checklist item 1.15 tracks this.

## Consequences

Until this is accepted the jobs run when a run is started by hand or when GitHub happens to fire the schedule. The Status page says so in words: a source that stops speaking shows as STALE, and the alerts table records it.

## Decision and build (2026-11-26)

Khaled chose option 2 after a second measurement: on 2026-11-25 and 26 the 15-minute heartbeat fired 9 times in two days, hours apart.

- `private.dispatch_workflow(file)` posts `{"ref": "main"}` to `https://api.github.com/repos/kghamdi84/Marsad/actions/workflows/<file>/dispatches` through `pg_net`, with the token read from Supabase Vault (`github_actions_token`). The file name must match `^[a-z0-9-]+\.yml$`. Without the token nothing is sent; the attempt is still recorded.
- 26 Supabase Cron jobs (`gh-<workflow>`) copy every `cron:` line of `.github/workflows` exactly, in UTC. A database test reads the workflow files and fails if a schedule is added, removed or changed on one side only.
- `scheduler-check` runs every 15 minutes: for the dispatches sent 17 to 2 minutes earlier it reads GitHub's replies (`net._http_response`, 204 is accepted) and writes one `scheduler` row to `job_runs`: `ok`, `error` with GitHub's reply (for example an expired token, HTTP 401), or `skipped` with "GitHub token not stored in Supabase Vault yet". The Status page shows it in Recent job runs and the 24-hour strips.
- The functions and the dispatch log live in the `private` schema; signed-in users and anon cannot call them (tested).
- The workflows keep their own `schedule:` as a backup. Known risk: Massive workflows share one concurrency group, and GitHub cancels a pending run when another joins the group, so a late GitHub-scheduled duplicate can cancel a queued run of another Massive workflow. The schedules are hours apart and every job is idempotent; if the Status page shows a missed run, the GitHub schedules can be removed.

What Khaled does (SETUP step 11): enable `pg_cron` and `pg_net` (Database, Extensions), create a fine-grained GitHub token (Actions: read and write, this repository only) and store it in Vault. When the token expires, the `scheduler` row turns to an error saying so.
