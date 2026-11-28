-- Supabase Cron start for the nightly ticker summary job (ADR 0050, ADR 0008). The schedule copies the `cron:` line
-- of .github/workflows/ticker-summary.yml exactly (UTC); the scheduler test fails if they drift apart.
select cron.schedule('gh-ticker-summary', '25 11 * * 2-6', $$select private.dispatch_workflow('ticker-summary.yml')$$);
