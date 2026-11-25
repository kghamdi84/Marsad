# ADR 0014: Watch dashboard on end-of-day data

- Status: accepted (starting rules; every change bumps the version)
- Date: 2026-11-25
- Version: `watch-1`

## Context

The brief's Watch dashboard has a market strip, the watchlist table, a heatmap, movers, a gap scanner, news and the calendar. The current Massive plan is end of day (no real-time quotes, no pre-market data), so every number is from the last completed session.

## Decision

- **Market strip**: SPY, QQQ, IWM, DIA and GLD from stored daily bars; VIX, the 10-year yield (change in points), WTI oil and the broad dollar from FRED. Each with its date.
- **Watchlist table**: the saved watchlist, or the starting tickers until one exists. From stored daily bars: close, 1-day, 1-week (5 sessions), 1-month (21 sessions) change, distance from the 252-session high close, and volume over the 20 sessions before. Each ticker links to its Study page.
- **Sector heatmap and movers**: computed by the breadth job from the stored, split-adjusted market snapshots for the last 5 sessions (`market_movers_daily`): the 11 Select Sector SPDRs' day change, and the 10 biggest gainers and losers among that month's Marsad universe members. A move over 50% is left out as a likely bad print (ADR 0010).
- **Gap scanner**: the last session's opening gap (open against the previous close) for the watchlist and the strip ETFs, largest first. Real-time pre-market gaps need a paid plan; the panel says so.
- **News**: the newest article clusters for the watchlist tickers (already stored by the news job); links only for https URLs.
- **Display**: changes carry a sign and an arrow as well as blue (up) or orange (down), so colour is never the only signal.

## Consequences

- No intraday view until a real-time plan is approved; the page states it is end of day.
- Movers and sectors appear after the breadth backfill; until then the panels say so.
