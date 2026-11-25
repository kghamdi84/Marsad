# ADR 0010: Marsad universe and breadth (definition, data and storage)

- Status: accepted (starting rules; every change bumps the version)
- Date: 2026-11-25
- Versions: `universe-1`, `breadth-1`

## Context

The brief asks for a breadth universe of "the top 1,000 US common stocks and ETFs by 20-day dollar volume, rebuilt monthly and stored point-in-time", labelled "Marsad universe breadth" and never as official index breadth, and for breadth inputs to the regime and the Fear and Greed composite: the share above the 50- and 200-day averages, net new highs, up versus down volume, a McClellan-style summation, and the Zweig breadth thrust.

Measured on 2026-11-25: Massive's grouped daily endpoint returns every US ticker for one session in one call on the free plan (12,650 on 2026-11-24). The free plan allows about 5 calls a minute and 2 years of history. The reference tickers endpoint takes a `date` and returns the tickers that traded that day, with their type.

## Decision

### Universe (`universe-1`)

- Eligible: Massive type `CS` (common stock) or `ETF`, from the ticker list as of a snapshot date. Snapshots are taken every 3 months; a rebuild uses the latest snapshot on or before it (the first one for earlier months). A ticker listed and delisted between two snapshots is missed; for the top 1,000 by dollar volume this is rare. ADRs, units, warrants, rights and preferred shares are not eligible. Leveraged and inverse ETFs are eligible, as the brief says "ETFs".
- Rebuilt on the first session of each month, from the 20 sessions before it (never the rebuild day itself): average close times volume over the sessions the ticker traded, at least 15 of the 20. Top 1,000; ties break by ticker.
- Stored per month in `universe_members` with rank and dollar volume.

### Breadth (`breadth-1`)

For each session, over that month's members:

- Advancers, decliners and unchanged (close against the previous close), with up and down volume.
- Above the 50- and 200-session average, out of the members with that many unbroken sessions.
- New 252-session high or low (by close), out of the members with 252 unbroken sessions.
- A move of more than 50% in a day is treated as a bad print and left out that day (counted as `suspect`); splits are adjusted first, so a split is never mistaken for one.
- Zweig breadth thrust, as the brief defines it: the 10-session average of advancers over (advancers plus decliners) rises from below 0.40 to above 0.615 within 10 sessions; it fires on the first day above 0.615.
- McClellan-style volume oscillator: the 19- minus the 39-session exponential average of (up volume minus down volume) over (up plus down volume); the summation adds it up from its first day.

### Data and storage

- Each session's grouped daily is fetched **unadjusted** (`adjusted=false`) and stored compactly in `market_snapshots` (gzip of the tickers with at least USD 1 million traded that day, encoding `gzip-base64-json-v1`). A top-1,000 member trades far more than that on a normal day: on 2026-11-24 the 1,000th largest traded USD 139.8 million. A member that trades less than USD 1 million on some day is treated as not trading that day, which only lowers its 20-session average.
- All-market splits (including stock dividends) are stored in `splits`. When the job reads the snapshots it puts every session on today's share basis from the stored splits, so the result depends only on what is stored.
- The job recomputes every universe and every breadth day from the stored snapshots on each run (one code path for the backfill and the daily update) and upserts `universe_members` and `breadth_daily`.
- First run: about 520 sessions plus ticker lists and splits, about 2 hours at 5 calls a minute, in one GitHub Actions run that resumes where it stopped if it fails. After that: one or two calls a day.

## Consequences

- Breadth history starts 2 years back (the free plan's limit); the 200-session measure and the 252-session highs and lows need most of the first year to warm up, so they begin in late 2025. The page says when a measure has too few members with enough history.
- Highs and lows are by close, not intraday high and low.
- A day with a bad print in a member that is later corrected counts the correction as a decline (the bad print itself is left out).
- While the first run takes about 2 hours, other Massive jobs wait (they share one concurrency group so as not to exceed the rate limit).
