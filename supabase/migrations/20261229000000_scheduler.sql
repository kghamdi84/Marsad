-- Reliable scheduling (ADR 0008, accepted by Khaled 2026-11-26). GitHub's own scheduler drops most runs in this
-- repository (the 15-minute heartbeat fired 9 times in two days), so the project's database starts the workflows
-- on time: Supabase Cron (pg_cron) calls GitHub's workflow_dispatch API through pg_net, with a fine-grained GitHub
-- token (Actions: read and write, this repository only) that Khaled stores in Supabase Vault as
-- `github_actions_token`. Until it is stored nothing is sent and the Status page says so. The jobs stay in GitHub
-- Actions; each workflow keeps its own schedule as a backup (every job is idempotent).
--
-- Every schedule below copies a workflow's `cron:` line exactly (UTC); a test fails if they drift apart.

-- The extensions are enabled in the dashboard (Database, Extensions); this only makes sure. The guard lets the
-- offline test database, which has neither extension, run the file against its stand-ins.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
end
$$;

-- One row per dispatch, kept 7 days: which workflow, when, and pg_net's request id to find GitHub's reply.
create table private.workflow_dispatches (
  id bigint generated always as identity primary key,
  workflow text not null check (workflow ~ '^[a-z0-9-]+\.yml$'),
  request_id bigint,
  sent_at timestamptz not null default now()
);
create index workflow_dispatches_sent_idx on private.workflow_dispatches (sent_at);

-- Starts one workflow on main. Without the token it records the attempt (request_id null) and sends nothing.
create function private.dispatch_workflow(workflow text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  token text;
  rid bigint;
begin
  if workflow !~ '^[a-z0-9-]+\.yml$' then
    raise exception 'not a workflow file name: %', workflow;
  end if;
  select s.decrypted_secret into token
    from vault.decrypted_secrets s
    where s.name = 'github_actions_token';
  if token is not null and length(token) > 0 then
    rid := net.http_post(
      url := 'https://api.github.com/repos/kghamdi84/Marsad/actions/workflows/' || workflow || '/dispatches',
      body := '{"ref": "main"}'::jsonb,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || token,
        'Accept', 'application/vnd.github+json',
        'X-GitHub-Api-Version', '2022-11-28',
        'User-Agent', 'marsad-scheduler',
        'Content-Type', 'application/json'
      ),
      timeout_milliseconds := 10000
    );
  end if;
  insert into private.workflow_dispatches (workflow, request_id) values (workflow, rid);
end
$$;

-- Every 15 minutes: how the dispatches of the window from 17 to 2 minutes ago went (GitHub answers 204 when it
-- accepts). Writes one `scheduler` row to job_runs, so the Status page shows refusals (an expired or wrong token),
-- missing replies, or that the token is not stored yet. Nothing is written for a window with no dispatch.
create function private.check_workflow_dispatches()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  sent integer;
  accepted integer;
  refused integer;
  no_token integer;
  no_reply integer;
  last_error text;
begin
  with w as (
    select d.request_id, r.status_code, r.error_msg, r.timed_out
    from private.workflow_dispatches d
    left join net._http_response r on r.id = d.request_id
    where d.sent_at > now() - interval '17 minutes' and d.sent_at <= now() - interval '2 minutes'
  )
  select count(*),
         count(*) filter (where status_code between 200 and 299),
         count(*) filter (where request_id is not null
                            and (status_code >= 300 or error_msg is not null or coalesce(timed_out, false))),
         count(*) filter (where request_id is null),
         count(*) filter (where request_id is not null and status_code is null and error_msg is null
                            and not coalesce(timed_out, false))
    into sent, accepted, refused, no_token, no_reply
    from w;
  select d.workflow || ': ' || coalesce(r.error_msg, 'HTTP ' || r.status_code || ' ' || left(coalesce(r.content, ''), 160))
    into last_error
    from private.workflow_dispatches d
    join net._http_response r on r.id = d.request_id
    where d.sent_at > now() - interval '17 minutes' and d.sent_at <= now() - interval '2 minutes'
      and (r.status_code >= 300 or r.error_msg is not null or coalesce(r.timed_out, false))
    order by d.sent_at desc
    limit 1;
  if sent > 0 then
    insert into public.job_runs (job, started_at, finished_at, status, rows_written, latency_ms, error, details)
    values (
      'scheduler',
      now(),
      now(),
      case
        when no_token = sent then 'skipped'
        when refused > 0 or no_reply > 0 then 'error'
        else 'ok'
      end,
      accepted,
      0,
      case
        when no_token = sent then 'GitHub token not stored in Supabase Vault yet (ADR 0008); nothing was sent'
        when refused > 0 then left(coalesce(last_error, 'GitHub refused a dispatch'), 480)
        when no_reply > 0 then 'No reply from GitHub for ' || no_reply || ' dispatch(es)'
      end,
      jsonb_build_object('sent', sent, 'accepted', accepted, 'refused', refused, 'noToken', no_token, 'noReply', no_reply)
    );
  end if;
  delete from private.workflow_dispatches where sent_at < now() - interval '7 days';
end
$$;

revoke all on function private.dispatch_workflow(text) from public, anon, authenticated;
revoke all on function private.check_workflow_dispatches() from public, anon, authenticated;
revoke all on table private.workflow_dispatches from public, anon, authenticated;

select cron.schedule('scheduler-check', '*/15 * * * *', $$select private.check_workflow_dispatches()$$);

-- The workflows' schedules, copied exactly from .github/workflows (UTC).
select cron.schedule('gh-backtest-lab', '20 6 * * 0', $$select private.dispatch_workflow('backtest-lab.yml')$$);
select cron.schedule('gh-brief-close-recap', '50 22 * * 1-5', $$select private.dispatch_workflow('brief-close-recap.yml')$$);
select cron.schedule('gh-brief-pre-market', '30 12 * * 1-5', $$select private.dispatch_workflow('brief-pre-market.yml')$$);
select cron.schedule('gh-brief-pre-market-2', '30 13 * * 1-5', $$select private.dispatch_workflow('brief-pre-market.yml')$$);
select cron.schedule('gh-fred-daily', '30 23 * * *', $$select private.dispatch_workflow('fred-daily.yml')$$);
select cron.schedule('gh-gpr-daily', '17 6 * * *', $$select private.dispatch_workflow('gpr-daily.yml')$$);
select cron.schedule('gh-halts', '*/5 7-23 * * 1-5', $$select private.dispatch_workflow('halts.yml')$$);
select cron.schedule('gh-halts-2', '*/5 0-1 * * 2-6', $$select private.dispatch_workflow('halts.yml')$$);
select cron.schedule('gh-health', '*/15 8-23 * * 1-5', $$select private.dispatch_workflow('health.yml')$$);
select cron.schedule('gh-health-2', '*/15 0-1 * * 2-6', $$select private.dispatch_workflow('health.yml')$$);
select cron.schedule('gh-health-3', '23 */3 * * *', $$select private.dispatch_workflow('health.yml')$$);
select cron.schedule('gh-massive-bars', '30 22 * * 1-5', $$select private.dispatch_workflow('massive-bars.yml')$$);
select cron.schedule('gh-massive-breadth', '40 10 * * 2-6', $$select private.dispatch_workflow('massive-breadth.yml')$$);
select cron.schedule('gh-massive-news', '5 12,15,18 * * 1-5', $$select private.dispatch_workflow('massive-news.yml')$$);
select cron.schedule('gh-massive-reference', '30 5 * * *', $$select private.dispatch_workflow('massive-reference.yml')$$);
select cron.schedule('gh-massive-sections', '45 5 * * 0', $$select private.dispatch_workflow('massive-sections.yml')$$);
select cron.schedule('gh-massive-study', '15 23 * * 1-5', $$select private.dispatch_workflow('massive-study.yml')$$);
select cron.schedule('gh-massive-topics', '20 1 * * *', $$select private.dispatch_workflow('massive-topics.yml')$$);
select cron.schedule('gh-quality-screen', '41 9 * * 0', $$select private.dispatch_workflow('quality-screen.yml')$$);
select cron.schedule('gh-reconcile-nightly', '45 0 * * *', $$select private.dispatch_workflow('reconcile-nightly.yml')$$);
select cron.schedule('gh-sec-facts', '15 6 * * 1-5', $$select private.dispatch_workflow('sec-facts.yml')$$);
select cron.schedule('gh-sec-filings', '7,37 11-23 * * 1-5', $$select private.dispatch_workflow('sec-filings.yml')$$);
select cron.schedule('gh-sec-insiders', '17 11-23 * * 1-5', $$select private.dispatch_workflow('sec-insiders.yml')$$);
select cron.schedule('gh-tauric-quotes', '*/5 13-21 * * 1-5', $$select private.dispatch_workflow('tauric-quotes.yml')$$);
select cron.schedule('gh-tauric-reconcile', '20 23 * * 1-5', $$select private.dispatch_workflow('tauric-reconcile.yml')$$);
select cron.schedule('gh-weekly-exports', '10 7 * * 0', $$select private.dispatch_workflow('weekly-exports.yml')$$);
