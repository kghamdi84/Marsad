# ADR 0050: Nightly per-ticker summary (`ticker_daily_summary`, `ticker-summary-1`)

- Status: accepted (batch 2 of ADR 0048)
- Date: 2026-11-28

## Context

ADR 0048 section 4 asks for one nightly table, keyed by version, date and ticker, that Watch, the quick look, Portfolio and the later screener read in one query instead of each page looping over bars. Today Watch reads the newest 260 bars of every watchlist ticker and calls `tickerSummary` (`watch-1`) and `traderMetrics` (`trader-1`); the quick look reads every stored bar and calls `summarizeBars` (`indicators-1`), `traderMetrics` and `companyBrief` (`periodReturn`, `company-brief-1`).

The whole-market snapshot (`market_snapshots`) holds about 5,000 common stocks and ETFs a session (ADR 0010). Supabase Free gives 500 MB per project (`docs/BUILD_PROMPT.md`).

## Decision

1. **Table `public.ticker_daily_summary`** (migration `20270106000000`, additive). Primary key `(version, date, ticker)`, index `(ticker, date desc)`. `date` is the last completed session; `close_date` is the ticker's newest bar, so a stale ticker shows as stale. Typed columns, null when unavailable: close; returns over 1W, 1M, 3M, YTD and 1Y; 52-week closing high, low and position (0 to 1); SMA 20, 50 and 200 with above-50 and above-200 flags; RSI 14; ATR 14 as a fraction of the close; stretch from the 50-day average in ATRs; 20-session average volume, volume against it and average dollar volume; strength against SPY over 63 sessions; trailing 12-month dividends and yield; next results date with its source (`tauric` or `marsad-estimate`); analyst count, mean target and recommendation; Tauric P/E and beta; sector fund. Bookkeeping: `coverage`, `unavailable` (the reason per null field), `sources` (each input with its as-of time), `formula_versions`, `computed_at`.
2. **RLS: one table, one read policy per coverage.** `tracked` rows are read by members (`coverage = 'tracked' and private.is_member()`): they come from `daily_bars`, `dividends` and `company_research`, which members already read. `market` rows are owner-only (`coverage = 'market' and private.is_app_owner()`): they come from `market_snapshots`, owner-only because Massive plans are for individual use (ADR 0048; migration `20270105120000`). One table keeps a single read for the pages and lets the screener filter by coverage; two policies keep the split in the database, not the client. Nobody signed in writes; no grants to `anon`. Tested in `supabase/tests/rls.test.ts`.
3. **Core `packages/core/src/ticker-summary.ts`**, pure. It calls `tickerSummary` (1W, range, volume ratio), `periodReturn` (1M, 3M, 1Y), `traderMetrics` (ATR, stretch, strength against SPY), `sma` and `rsi`; the volume averages are `sma` of volume and of close times volume over the 20 sessions before the newest (the base of Watch's ratio). New rules, each with a hand-checked test: YTD is against the last close of the previous year, which must fall in the last 7 days of that year; trailing dividends count ex-dates in the 365 days ending on the close date, on today's share basis (the vendor's split-adjusted amount, else the stored splits), and a non-USD dividend makes the figure unavailable; the next results date is Tauric's stated date when it is after the session, else Marsad's `calendar-1` estimate; the sector fund is the Select Sector SPDR of the GICS sector in the Tauric profile (the funds track GICS sectors one to one; an unknown name gives null). Bars after `date` are ignored (point in time).
4. **Job `ticker-summary`** (`jobs/src/ticker-summary-job.ts`, workflow `.github/workflows/ticker-summary.yml`, Supabase Cron `gh-ticker-summary` in migration `20270106000100`), 11:25 UTC Tuesday to Saturday: after the bars (22:30), research (09:35) and breadth (10:40) jobs and before the open. Stored data only, no vendor calls. Tickers: SPY, open holdings, every watchlist ticker, the sector funds chosen on watchlists, and the funds the GICS mapping assigns. Stored research parts are validated again, as the web app does; a part that fails is dropped with `malformed: <reason>`. Each run writes `job_runs` with the session, row count, tickers with no bars and stale tickers. A ticker that fails is named and the run is an error after the others are written.
5. **Whole-market rows are not written yet.** About 5,000 rows a session at about 0.4 KB with indexes is about 2 MB a session, about 500 MB a year: the whole free database. The schema and the owner-only policy are ready. Writing them needs one of: Supabase Pro (8 GB, Khaled's cost decision), or keeping only the newest session's market rows, which deletes the previous day's (a delete, so Khaled decides). Tracked rows cost about 10 MB a year for 20 tickers.

## Parity with the pages

A job test (`ticker-summary-job.test.ts`) runs the job on a fake store and recomputes each field through the pages' own calls. Equal exactly: close, 1W, 1M, 3M, 1Y, the 52-week closing range (Watch), SMA 50 and 200, the trend flags, RSI, volume ratio, ATR %, stretch and strength against SPY (quick look). Differences, left in the pages for batch 4:

- Watch's ATR, stretch and RSI are seeded at the start of its 260 bars; the row's at the first stored bar. They agree to better than 1e-6 (the seed's weight after 246 steps is about 1e-8).
- The quick look's 52-week range uses intraday highs and lows over up to 252 bars (a shorter window when history is short). The row and Watch use closes over exactly 252 sessions.
- The quick look shows one day's dollar volume; the row stores the 20-session average.
- Watch's days to earnings use only Marsad's estimate; the row prefers Tauric's stated date.
- Watch's sector fund is each viewer's own choice per watchlist item; the row uses the GICS sector. Strength against the sector fund is not stored.
- The quick look's 1M, 3M and 1Y beside SPY and the sector are not stored; only the ticker's own return is.

## Consequences

- Pages can move to one read per ticker list in batch 4; they still need bars for sparklines and the chart.
- Tracked rows reveal which tickers anyone tracks to every member, as `daily_bars` and `company_research` already do.
- No `source_status` row: no rule reads this table yet. A missing or failed run shows on the Status page through `job_runs`, and each row carries its `close_date`.
