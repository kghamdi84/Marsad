-- Supabase Cron start for the daily company research job (ADR 0047, ADR 0008). The schedule copies the `cron:` line
-- of .github/workflows/tauric-research.yml exactly (UTC); the scheduler test fails if they drift apart.
select cron.schedule('gh-tauric-research', '35 9 * * 2-6', $$select private.dispatch_workflow('tauric-research.yml')$$);
