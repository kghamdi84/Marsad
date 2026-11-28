# ADR 0049: Whole-market movers (`movers-1`)

- Status: accepted (starting rules; every change bumps the version)
- Date: 2026-11-28
- Version: `movers-1`
- Related: ADR 0010 (snapshots, splits), ADR 0014 (Watch movers, `watch-1`), ADR 0040 (members), ADR 0048 (council verdict: placement and access)

## Context

Khaled sent TipRanks' Market Movers page (gainers, losers, active, after hours, 52-week high and low, unusual volume, a market-cap filter and an AI catalyst line per row) and asked for Marsad's version. Marsad already stores every US ticker's unadjusted close and volume per session (`market_snapshots`, sessions under USD 1 million traded are not stored), quarterly common-stock and ETF lists and all-market splits (ADR 0010). The existing Movers card shows the 10 biggest gainers and losers among the 1,000-member Marsad universe (`watch-1`).

ADR 0048 sets the placement (Markets page later; built self-contained now) and these rules: "Last completed session (end of day)"; a liquidity floor; an "On my list" filter; the unusual-volume rule on screen; the 25% corporate-action guard; the catalyst labelled "Latest stored headline, not a verified cause"; whole-market lists owner-only; no push alerts.

## Decision

### Where it is computed

In the breadth job, which already loads every stored session split-adjusted with the ticker lists. A session is about 5,000 tickers (about 90 KB compressed); the 52-week views need 252 sessions (over 20 MB), too much for a browser. The job stores one row per session (the last 5, like `watch-1`) in `market_movers_market` (owner-only). The browser reads one row.

"On my list" runs the same core function in the browser over the watchlist and open holdings, from their stored daily bars (a few dozen tickers), with the stored splits as checks.

### Formula (`packages/core/src/movers.ts`)

- Eligible: common stocks and ETFs from the latest quarterly ticker list on or before the session.
- Bad prints, counted and left out of every list: a zero or negative close or previous close, or no previous close stored.
- Liquidity floor (`LIQUIDITY_FLOOR`), left out of every list: a close under USD 1, or under USD 2 million traded (close times volume). The minimum dollar-volume filter offers USD 2 million, 10 million, 100 million and 1 billion. Marsad stores no market capitalisation for the whole market, so it filters by dollar volume instead.
- Gainers and losers: change from the previous session's close. Most active: dollar volume.
- Unusual volume (`UNUSUAL_VOLUME`): the session's volume at least 3 times the average of the previous 20 sessions (all 20 stored) and at least USD 5 million traded. The 50-session ratio is shown beside it, never ranked on.
- New 52-week highs and lows, by close: the session's close at or beyond the highest (lowest) close of the 252 stored sessions ending with it, as in `breadth-1`. Needs 252 stored sessions; otherwise the view says how many are stored and needed.
- Corporate-action guard (CLAUDE.md rule 6): a move over 25%, a split or ticker change taking effect on the session, or (unusual volume only) one inside the 20 sessions behind the average, puts the ticker under "Check corporate action" instead of the ranked list. Marsad has no whole-market ticker-change feed, so the job passes none; a renamed ticker has no previous close under its new symbol and is left out as a bad print.
- 15 rows per list and per check list, with the count that qualified. Ties break by ticker.

### Catalyst

Code-matched, not AI: the newest stored news article (by publication time) or SEC filing (by acceptance time, else filing date) for the ticker since 00:00 ET of the previous session, with its source and time in ET and local time. Labelled "Latest stored headline, not a verified cause". With none: "No stored news or filing for this ticker". Marsad never writes why a stock moved.

### Access

- `market_movers_market`: owner-only (`private.is_app_owner()`), as ADR 0048 asks (Massive's plans are for individual use). `market_snapshots` and `ticker_type_snapshots`, opened to members by the members migration, go back to owner-only.
- `market_movers_daily.market_version` (member-readable) records that an owner row exists, so a member sees "Available to the owner only" rather than "not computed yet". Members keep the Marsad universe view.

### Not built

After-hours movers (ADR 0048 cuts them; the view says end-of-day only). No push alerts and no alert rules read movers.

## Consequences

- Whole-market lists appear after the breadth job's next run once the migration is applied. Until then the view says they are not computed yet.
- 52-week views need about a year of stored sessions; a ticker with any session under USD 1 million traded in the window is left out of them, and of unusual volume when that session is in its 20.
- A newly listed ticker is left out until the next quarterly ticker list.
