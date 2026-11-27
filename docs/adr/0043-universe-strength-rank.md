# ADR 0043: Universe strength rank and a sector fund per watchlist ticker

- Status: accepted
- Date: 2026-11-27

## Context

The council review (26 November 2026, batch 3 leftovers) asked for each ticker's relative strength against its sector fund and a rank in the 1,000-stock universe. Marsad already stores every session's grouped-daily closes for the whole market (`market_snapshots`) and rebuilds the top-1,000 universe each month (`universe_members`, ADR 0010). It does not know which sector a watchlist ticker belongs to: the SEC and Massive data on the free plans give SIC codes at best, and mapping SIC to the eleven Select Sector SPDR funds would be a guess.

## Decision

1. The breadth job ranks the newest session's universe members by their 63-session price return (formula `strength-1`, `packages/core/src/strength.ts`, hand-checked tests) and stores the ranks in `strength_rank_daily` (additive migration `20261230000000_strength_rank.sql`). Members without a close at both ends of the window are left out. The percentile says how many members a ticker beat. Shared market data: members read it (ADR 0040); only the job writes it.
2. The sector fund is the viewer's own choice per watchlist ticker (`watchlist_items.sector_etf`, nullable, one of the eleven Select Sector SPDR funds), set in "Edit list". Strength against the sector is shown only when a fund is set; otherwise the column says "No sector set".
3. Watch shows both in the "Trader columns" view; the quick look shows the rank. A ticker outside the universe says "Not in universe".

## Consequences

- No new vendor calls: the ranks come from data the breadth job already stores. The first ranks appear after the next breadth run once the migration is applied.
- The rank is Marsad's own universe measure from end-of-day data, labelled as such, not an index or vendor ranking.
- The broader nightly per-ticker summary (one read for the whole Watch page) is not built: Watch still reads each ticker's bars, which it needs for sparklines and ranges.
