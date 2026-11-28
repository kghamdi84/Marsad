# ADR 0053: Pages on the nightly summary, the screener link format, lazy Study views and the bundle budget

- Status: accepted (batches 4 and 6 of ADR 0048)
- Date: 2026-11-28

## Context

ADR 0050 added `ticker_daily_summary` so Watch, the quick look and Portfolio read one row per ticker instead of looping over bars, and listed where the pages and the row differ. ADR 0048 batch 6 asked for a screener on the table, the dividend comparison, the time-weighted portfolio result, lazy chunks per Study view and a bundle budget in CI.

## Decision

1. **When a page uses the row.** `lib/summary.ts` reads the newest `ticker-summary-1` row per ticker in one request. A page uses it only when its `close_date` is not older than the newest bar the page holds for that ticker. Otherwise the page computes the same row from its bars with core's `tickerDailySummary` (the job's function, without research or dividends, so those fields show as unavailable) and says so: "from the nightly summary, <date>" or "computed from bars". A stale row is not used for any field, including its results date.
2. **Watch reads less.** The summary first (it names the GICS sector fund), then the bars of every Watch ticker in batched reads of 70 sessions: enough for the sparkline, the 1-day change (the row has none), the 1-month change and the strength against the sector fund (not stored). A watchlist ticker without a current row reads its full year as before. With eight names and three holdings, REST requests fell from 40 (19 bar reads) to 28 (6), and Portfolio's from 15 to 14 (Marsad's estimates are read only when a holding has no current row). The batch reads respect PostgREST's 1,000-row cap and re-read a ticker alone when a read fills its limit.
3. **The ADR 0050 differences, resolved.** The quick look's 52-week range is on closes, labelled "by close". Dollar volume shows the 20-session average and the one-day figure, each labelled. The results date comes from the row (Tauric's stated date, else Marsad's estimate) with its source. The sector fund a viewer chose on Watch wins over the row's GICS fund, and the cell says which.
4. **Screener link format.** `/screener?f=field:op:value,...&s=field:dir`. `between` takes `low_high`; booleans take `true` or `false`; `isNull` and `notNull` take no value. Values are core's units (fractions for returns and ratios; the page shows and takes percent). Every part is checked by core's `filterProblem`; a part that fails is dropped and named on the page. The screener reads the newest session's rows; row-level security decides whether market rows are included, and the scope line says which.
5. **Lazy Study views.** Each of the ten Study views is its own module under `components/study/views/`, loaded the first time its tab opens. The research section wrappers moved out of `research/Research.tsx`, which now holds only the shared hooks, so importing a hook no longer pulls every view. The company page chunk fell from 67.0 KB to 23.0 KB and the chunk it shares with the quick look from 108.1 KB to 19.1 KB.
6. **Bundle budget.** `apps/web/bundle-budget.mjs` holds the limit for the main entry chunk (the script `index.html` loads first): 361,904 bytes, the 329,004 bytes measured on 2026-11-28 in CI's build (no `VITE_` variables; 332,743 with them) plus 10%. `apps/web/scripts/check-bundle.mjs` runs in CI after the build and fails when the chunk is over. Raising the budget is a deliberate change with a new measurement.

## Consequences

- Before the job's first run, and for a ticker the job does not cover, pages behave as before and say "computed from bars".
- A stored row one session behind the bars is ignored entirely, so its Tauric results date is not shown until the next run.
- The screener sees tracked tickers only until whole-market rows are written (ADR 0050 section 5, a storage decision for Khaled).
- Opening a Study view for the first time costs one small extra request for its chunk.
