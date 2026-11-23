# Batch jobs

Node jobs run by GitHub Actions on schedules: end-of-day reconciliation, universe breadth, regime statistics, backtests, the scorecard, event studies and the weekly review. They import `@marsad/core` and write to Supabase with the secret key stored as an Actions secret.

The first job arrives in Phase 1 (nightly reconciliation). Every job writes a `public.job_runs` row.
