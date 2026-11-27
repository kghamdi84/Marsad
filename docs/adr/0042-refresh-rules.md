# ADR 0042: Refresh rules for end-of-day data and quotes

- Status: accepted
- Date: 2026-11-27

## Context

The council review (26 November 2026, batch 5) found that every page reloaded all its data every 10 seconds and on each return to the app (`staleTime: 10_000` in `apps/web/src/main.tsx`), and that the quote view polled every minute around the clock. Marsad's prices are end of day: daily bars, indicators, regime, filings and briefs change once a session or less. Only the quote view (Tauric snapshots, ADR 0041) can move during the day.

## Decision

1. Queries default to `staleTime` 30 minutes (`EOD_STALE_MS` in `apps/web/src/lib/refresh.ts`). Returning to the app refetches only data older than that.
2. The quote view is never treated as fresh (`staleTime: 0`) and polls once a minute only while the regular session is open, read from the same pulse query as the market chip. Before the pulse loads, and in pre-market, after-hours and closed states, it does not poll.
3. The pulse itself (market chip and freshness dot) keeps its one-minute poll: it is how silence is noticed (integrity rule 2).
4. Pull to refresh still refetches every active query on the screen at once.

## Consequences

- Far fewer requests on the iPad; a page reopened within 30 minutes shows what it loaded, with its as-of dates unchanged on screen.
- A job that finishes while a page is open appears after 30 minutes or on pull to refresh. Freshness labels come from the stored as-of times, so a page is never mislabelled by the cache.
- When the paid real-time plan arrives (checklist 5.1), quotes keep the same session rule with a shorter interval.
