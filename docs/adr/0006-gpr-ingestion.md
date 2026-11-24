# ADR 0006: GPR ingestion runs in a GitHub Actions job

- Status: accepted
- Date: 2026-11-23

## Context

The Geopolitical Risk Index daily series is published only as a legacy Excel (`.xls`, BIFF) file of about 3.2 MB. Supabase Edge Functions have a 2-second CPU limit and no Excel reader, and Edge Functions are meant for small, frequent work. The series changes at most daily.

## Decision

- A scheduled GitHub Actions job downloads the file, converts the sheet to rows, validates them with `parseGprRows` (`packages/core/src/gpr.ts`), and upserts into Postgres with the secret key. The conversion step uses Python (`xlrd`), a maintained reader for this format, then hands rows to the Node job as JSON.
- The validation and percentile logic stay in `packages/core`, so the web app and Edge Functions use the same code on the stored rows.
- Raw `.xls` files are not stored; the job records its row count and latest date in `public.job_runs`.

## Consequences

- No Excel parser enters the web app or Edge Functions.
- The job needs Python in the workflow, which GitHub-hosted runners include.
