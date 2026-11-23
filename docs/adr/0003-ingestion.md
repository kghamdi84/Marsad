# ADR 0003: Ingestion by polling, driven by Supabase Cron

- Status: accepted (implementation in Phases 1 and 5)
- Date: 2026-11-23

## Context

Serverless platforms cannot hold a WebSocket open all day. Supabase Cron can schedule jobs every 1 to 59 seconds and call Edge Functions through pg_net. Edge Functions have a 150-second wall clock on Free (400 seconds on paid plans) and about 2 seconds of CPU per request. Supabase recommends at most 8 concurrent cron jobs, each under 10 minutes. Second-level schedules cannot be combined with other cron fields.

## Decision

- One pg_cron job runs every 15 seconds and calls a `tick` Edge Function.
- `tick` computes the US session state from the market calendar (holidays and early closes from Massive `/v1/marketstatus/upcoming`, cached daily). Outside 04:00 to 20:00 ET on trading days it returns immediately.
- Inside sessions it fans out to small, focused functions: prices and indices (every tick), news and halts (15 to 30 seconds), filings (60 seconds), options for watchlist underlyings only (60 seconds). Each requests only the tickers, expirations and strikes it needs, computes incrementally and writes.
- One-minute bars are built from snapshots with gap detection and backfilled from official minute aggregates every 5 minutes.
- Heavy work (reconciliation, breadth, backtests, event studies, scorecard, weekly review) runs in GitHub Actions on schedules.
- Every invocation writes a `job_runs` row (start, end, rows, latency, error), created in the Phase 0 baseline.
- An optional streaming worker (Phase 9) may later write into the same tables.

## Consequences

- Latency is 10 to 30 seconds. That is acceptable because Marsad's value is filtering and context, not speed.
- The free Massive tier allows about 5 calls per minute, so live polling at this cadence requires a paid Stocks plan (decided in Phase 5). Phase 1 adapters include a token bucket, caching and backoff from the start.
