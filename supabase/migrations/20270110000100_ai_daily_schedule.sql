-- Supabase Cron start for the daily AI job (ADR 0007, ADR 0008). The schedule copies the `cron:` line of
-- .github/workflows/ai-daily.yml exactly (UTC); the scheduler test fails if they drift apart.
select cron.schedule('gh-ai-daily', '50 0 * * 2-6', $$select private.dispatch_workflow('ai-daily.yml')$$);
