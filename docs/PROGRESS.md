# Progress

## Current state (2026-11-28): every item that can be built on the current free plans is built and live. What is open waits on Khaled.

- **Setup done 2026-11-28 (verified live):** the scheduler (Supabase Cron started ticker-summary at 11:25 UTC, GitHub accepted; 1.15), Web Push (test sent to 2 of 2 devices; 5.6), Telegram (test delivered; 5.7), Khaled's look at Regime (3.9). Run by hand the same day after the missed schedules: breadth through 27 Nov, Tauric research (11 of 15 tickers; MARA, HIMS, RGTI, BBAI not covered by Tauric), the nightly summary, FRED, regime and calendars.
- **Done later on 2026-11-28:** Khaled's holdings entered (9 positions); breadth checked like for like against published S&P 500 breadth (3.3: 53.37% against 53.47% on 24 Nov, 54.81% against 53.08% on 25 Nov) after ETF holdings were matched through OpenFIGI (etf-3: 496 of SPY's 503 common stocks, FIGIs stored); feed-down and halt alerts delivered by push and Telegram (5.11, 5.14). Fixes from the Gemini hand-off screenshots: beta limit by size, unscored alerts off the scorecard, a missing full stop.
- **Email live 2026-11-28:** the weekly review went out by email (Resend), push (2 devices) and Telegram (5.8, 3.13). Still open, free: Khaled's stops and exit rules for his holdings (his decisions), and his choice on restoring the second sign-in factor (ADR 0039).
- **Paid, declined for now:** Massive Stocks plan with Supabase Pro (5.1 to 5.3, then 5.4, 5.10, 5.13 live), Massive options (6.x, 7.1 marks), Anthropic key with cost caps (2.9, 2.10, 7.8, 8.1), real-time (9.1).

Last updated 2026-11-28 (live setup checks, OpenFIGI matching, breadth checked; pages on the nightly summary, Screener, dividend comparison, actual portfolio result, lazy Study views and a bundle budget; before that the Markets and Portfolio pages and the earnings guard).

### Pages on the nightly summary, Screener, dividend comparison, actual result, bundle budget (2026-11-28, ADR 0048 batches 4 and 6, ADR 0053)

- **Summary consumers** (`lib/summary.ts`): one read of the newest `ticker-summary-1` row per ticker. A page uses the row when its close date is not older than its newest bar, else computes the same row from bars with core's `tickerDailySummary`, and says which ("from the nightly summary, <date>" or "computed from bars").
  - Watch: rows read range, 1W, 1M, volume, ATR, stretch, strength against SPY and the results date from the row; bars come in batched reads of 70 sessions (sparkline, 1-day change, strength against the sector fund). New Earnings column: days to the next results date with its source (Tauric date or Marsad estimate). The viewer's own sector fund wins over the row's GICS fund, and the cell says which.
  - Quick look: 52-week range by close (labelled), RSI, ATR, stretch, strength and volume from the row, dollar volume for 1 day and the 20-session average, the next results date from the row with its source.
  - Portfolio: Performance, Earnings and Technicals columns from the row (the readings count stays on bars); Marsad's estimates are read only when a holding lacks a current row.
  - REST requests (eight watchlist names, three holdings; `e2e/requests.spec.ts`): Watch 40 before (19 bar reads), 28 after (6); Portfolio 15 before, 14 after.
- **Screener** (`/screener`, lazy): presets, filters on every summary figure, sort, reasons per match, counts (matched, failed, left out for missing data, by figure). Filters in the address (`?f=`, `?s=`), checked by core; a bad part is dropped and named. "Tracked tickers only" unless market rows exist. Reached from the phone's More sheet and a link in the Markets header on desktop and iPad (desktop tabs unchanged).
- **Compare dividend returns** (Portfolio, Income): core `dividend-compare-1` over the holdings and watchlist payers (add or remove tickers), amount, years, DRIP, withholding (30% default, editable). Each row shows the projection with the 1-year price change beside it and the historical 1-year and 3-year total returns (or core's reason). Method line verbatim from core. Export CSV in the browser.
- **Your actual result** (Portfolio, Performance): core `portfolio-return-1` from Journal trades and stored closes: time- and money-weighted return, SPY with the same cash flows, the period, trade and missing-close counts, what is not counted, the method (dividends not included, fees as stored: none yet). The holdings chart keeps "Current holdings at today's weights, not your actual result".
- **Lazy Study views and bundle budget**: each Study view is its own chunk (`components/study/views/`). StudyCompany 67.0 KB to 23.0 KB, the quick look's shared chunk 108.1 KB to 19.1 KB. Main entry chunk (built with the Supabase variables set): 332.0 KB at the start of this work (329.1 KB at the previous entry), 332.7 KB after (100.6 KB gzip); 329.0 KB in CI's build. Budget 361,904 bytes (the 329,004 bytes of CI's build, without the `VITE_` variables, plus 10%) in `apps/web/bundle-budget.mjs`; CI runs `apps/web/scripts/check-bundle.mjs` after the build (checked failing with a lower budget).
- Checks: tsc (web, core, jobs), ESLint (root and web), Prettier, 1,408 unit tests, 61 database tests, Playwright 317 passed and 15 skipped (desktop and iPad, PW_PORT=4226), bundle budget. New specs: summary, requests, screener, dividend-compare, actual-result. Screenshots of Watch, Screener, the comparison and the actual result checked in both themes at 1280 by 900, then deleted.
- Shows live after the ticker-summary job has written rows (migration `20270106000000` applied); until then every page says "computed from bars" and the screener says no rows yet.

### Markets and Portfolio pages, navigation and view URLs (2026-11-28, ADR 0048 batches 1 and 3, ADR 0051)

- **Strings split** (ADR 0051): `apps/web/src/strings.ts` gathers per-area modules under `apps/web/src/strings/`; `t` is unchanged (checked value by value against the old file).
- **View URLs**: every switchable area reads `?view=` (the URL wins, the device's remembered choice is the fallback, switching replaces the history entry). Study's ten views, Journal, Portfolio, Markets, Settings and Status. Watch keeps its remembered switches.
- **Portfolio** (`/portfolio?view=review|holdings|analysis|performance|income|news`), moved out of Journal: summary tiles first, then one view, opening on Review. Holdings also carries the position cards (exit rules, edits, Sahm CSV import) and options positions; Analysis carries exposure and the ETF look-through. Old Journal tabs (`?view=positions|portfolio|options|exposure`) redirect to the view that holds them.
- **Journal** (`/journal?view=trades|sizer|review`): what Khaled did.
- **Markets** (`/markets?view=regime|movers|sectors|calendar`) replaces Regime; `/regime` redirects to `?view=regime` and keeps the hash. A "Markets today" card first (regime run, leading and lagging sector fund, the Marsad universe's top gainer and loser, the next high-impact release and the count of estimated earnings), each row from the same stored rows as its view. Movers: the whole-market list. Calendar: 30 days of macro releases and estimated earnings plus ex-dividend dates by day. Watch keeps the universe movers card; its calendar, dividends, sectors and movers cards end in a "See all" link into Markets. Watch's calendar stays at 14 days (the ADR's site map says 7; left unchanged so the existing view keeps its content).
- **Navigation**: desktop and iPad Watch, Markets, Study, Portfolio, Journal, Alerts, Lab, Status, Settings gear; number keys 1 to 9 in that order, S still opens Status. Phone: Watch, Study, Portfolio, Markets, Alerts, More (Journal, Lab, Status, Settings, Sign out). Arabic: Markets "الأسواق", Portfolio "المحفظة".
- **Study**: "Recently viewed" (last 8 tickers, this device only, storage guarded) above the search; "Size a trade" on Study's header and each Portfolio review row opens `/journal?view=sizer&ticker=XYZ` with the ticker filled in.
- **checklist-3** (ADR 0048 round 2): checklist-2's five checks plus checklist-1's "Risk is defined" and "There is a profit plan", for new trades; old trades keep their version. "Risk defined" can be ticked only with a stop and the ticket's shares (new optional field) at or below the sizer's result; it says why when locked and clears when the sizing changes. Migration `20270108000000` widens the version check (the column default stays `checklist-1`).
- **Portfolio limits in Settings** (Settings, "Limits, Shariah and AI caps"): table `portfolio_limits` (`20270108000100`, personal, MFA rule, no anon, no delete, versioned) seeded for the app owner with the council's values (`20270108000200`: 20%, 60%, 10%, beta 1.5, 6%, "Set by the council at your request on 28 Nov 2026"); members start with "No limit set". Portfolio reads the stored row and says who set it, with a link to change it.
- Bundle: main `index` chunk 349.6 KB before, 329.1 KB after (98.4 KB gzip; the whole-market movers moved into the Markets chunk). Portfolio (79.6 KB) and Markets (51.7 KB) are lazy chunks; Journal fell from 99.3 KB to 20.3 KB.
- Checks: tsc (web, core, jobs), ESLint, Prettier, 1,360 unit tests, 61 database tests, Playwright 297 passed and 15 skipped (desktop and iPad). Not run live: needs the three migrations (`20270108000000` to `20270108000200`) applied.

### Earnings guard, job side (2026-11-28, ADR 0052, batch 5 of ADR 0048)

- New alert: a holding whose next results date is within 5 trading sessions of the last completed session gets one factual alert per date, for example "NVDA reports in 4 sessions (Tauric date 2026-12-03). You hold 13 shares; stop 160.00, 8.1% below the close; exit rules set." No advice wording.
- Date: Tauric's stated date first, then Marsad's estimate (labelled as estimated, with its window), through the same `nextResultsDate` the summary row uses. Sessions skip weekends and market holidays (`tradingSessionsBetween`).
- Rule `earnings-guard` v1, live, set in code like the exit rules (a calendar notice, nothing to backtest). New alert kind `earnings` (additive migration `20270107000000`), not scored by the scorecard. Each alert stores its `earnings-guard-1` snapshot; replay recomputes the stored input exactly.
- A changed date creates a new alert that names the earlier one. A holding with no stored date is listed in the run, not alerted. A date source older than 7 days is named and the run fails after storing the rest.
- Job `earnings-guard` runs as a step of the ticker summary workflow (11:25 UTC, Tuesday to Saturday, after the research job), then the push dispatcher. Quiet hours and the push cap from Settings apply.
- Not done here: the Alerts page label for the new kind (`strings.ts`, the pages agent's file) and days to earnings on watchlist rows (batch 4).

### Portfolio views and the ex-dividend calendar (2026-11-28, ADR 0048)

- Journal has a new **Portfolio** tab with six views behind one remembered switch, in the order ADR 0048 gives the future `/portfolio` page. Each view is its own component with its own data hook (`components/portfolio/`), so the navigation batch moves them by rendering `PortfolioView` from the route.
  - **Review** (first): total open risk to the stops as a share of equity, with "risk unknown" counted beside it for holdings without a stop (never zero); the council's limits against the book with each breach written out with its figures; then every holding, those without exit rules first, with the condition met or missing, distance to stop in % and ATRs, dollars at risk, size against the sizer cap, sessions held, next earnings and "The sizer allows N shares; you hold M". Coming up (8 weeks of earnings, ex-dates and dated Tauric catalysts) and Weekly moves (above 5% over five sessions, plus stored alerts) sit one tap away. No alert is computed in the browser.
  - **Holdings**: summary row (value, day change, unrealized result, cash "Not tracked", top movers), "Portfolio vs SPY" labelled "Current holdings at today's weights, not your actual result", and one table with five column sets (Holdings, Performance, Dividends, Earnings, Technicals). The Analyst column set and the target card were cut (ADR 0048).
  - **Analysis**: the check (`portfolio-check-1`): limits first, then Marsad's check rules, sectors, performers, options exposure, the 60-day chart and a paragraph written by code; Needs attention (fact, rule and each position's exit condition only); Groups; Distribution (asset split, sector, market cap, dividend, beta and P/E buckets, portfolio beta and P/E with "n of N holdings" coverage).
  - **Performance**: closed trades in R; under 30 closed trades only counts ("4 of 16 closed trades were profitable"). Current holdings over 1M, 6M, 12M, YTD and monthly bars against SPY, and recent activity (Opened, Added, Closed).
  - **Income**: forward 12-month dividends by holding, yield on cost and on price, net of 30% withholding (US non-treaty rate, IRS Publication 515; Khaled to confirm).
  - **News**: stored articles for holdings with a ticker filter, search and a reading pane (description only, link out, no images).
- Limits: largest position 20%, top 5 60%, minimum cash 10%, beta 1.5, open risk 6% of equity, labelled "Set by the council at your request on 28 Nov 2026; change any time". A member sees "No limit set". `resolveLimits` already takes stored per-user limits for the later batch.
- Watch: the news and calendar switch gains **Dividends**, a day strip from 7 days back to 14 ahead with ex-dates of watchlist and holdings tickers (stored Massive dividends and Tauric's calendar), pay date, amount, frequency and yield at the last close. Marsad's tickers only; the market-wide list works on the plan and is in IDEAS.md.
- Not available, said on screen: cash (not stored), crowd insights (no other-investor data), geographic allocation (no source), current option values (options plan).
- Deferred by ADR 0048: the dividend returns comparison.

### Portfolio views in Journal, ready to move to /portfolio (2026-11-28, ADR 0048)

- Self-contained views: Review (first: exit condition met or "Exit rules missing", distance to stop in % and ATRs, dollars at risk, size against cap, sessions held, next earnings, the sizer's shares against yours; total open risk with a "risk unknown" count), Holdings (column sets: holdings, performance, dividends, earnings, technicals on `technical-1`; no analyst columns), Analysis (portfolio check `portfolio-check-1`, attention cards as facts plus rule plus exit condition, allocation, portfolio P/E and beta with coverage), Performance (in R; counts only below 30 closed trades), Income (forward 12-month income, yield on cost, net of an editable 30% withholding), News (holdings news with a reading pane). Ex-dividend view in Watch's calendar.
- Limits set by the council at Khaled's request (largest position 20%, top 5 60%, cash 10%, beta 1.5, open risk 6%); members see "No limit set"; a failed role check also shows "No limit set" instead of waiting.
- Checks: tsc, ESLint, Prettier, 1,319 unit tests, 58 database tests, Playwright 242 passed and 12 skipped.

### Nightly ticker summary (2026-11-28, ADR 0050, batch 2 of ADR 0048)

- New table `ticker_daily_summary` (additive migration `20270106000000`): one row per ticker per session with close, returns (1W, 1M, 3M, YTD, 1Y), the 52-week closing range, SMA 20/50/200, RSI, ATR %, stretch, volume and dollar-volume averages, strength against SPY, trailing dividends and yield, next results date with its source, analyst count, mean target and recommendation, P/E, beta and sector fund. Each null figure states its reason; each row names its sources and formula versions.
- RLS: members read 'tracked' rows; 'market' rows are owner-only (from `market_snapshots`). Nobody signed in writes.
- Core `ticker-summary-1` reuses `tickerSummary`, `periodReturn`, `traderMetrics`, `sma` and `rsi`; known-answer tests on hand-built bars.
- Job `ticker-summary` at 11:25 UTC Tuesday to Saturday (workflow plus Supabase Cron), stored data only. It writes tracked rows only: whole-market rows would fill the 500 MB free database in about a year (decision for Khaled in ADR 0050).
- Parity test against Watch and the quick look; the differences (ATR seed window, intraday vs closing 52-week range, daily vs average dollar volume, earnings source, sector fund source) are listed in ADR 0050. No page reads the table yet (batch 4).
- Verified: core, jobs and Supabase tests, typecheck, ESLint and Prettier (counts in the commit's report). Not run live: needs the migrations applied and a workflow run.

### Council verdict on the TipRanks features (2026-11-28, ADR 0048)

- Six-member council (trader, investor, information architect, integrity and cost auditor, architect, risk coach). Khaled adopted the verdict as the plan.
- New pages: Portfolio (`/portfolio`, opens on a Review of exits, stops and open risk) and Markets (`/markets`, replaces Regime and adds whole-market movers and the calendar). Study regroups into ten views. Every view gets a `?view=` URL.
- Cut: health score, crowd insights, buy/sell gauges, headline upside, analyst column on holdings, FAQ, call summaries, after-hours. Paid add-ons: none.
- Build order: in-flight work into PR #83, strings split, `ticker_daily_summary`, navigation, consumers, portfolio limits and earnings guard, then later items in IDEAS.md.

### Study company page in ten views (2026-11-28, ADR 0048)

- The chart stays on top; below it one view at a time: Overview, Analysts, Financials, Earnings, Technicals, Dividends, Ownership, News, Filings, Shariah aid. The tab row wraps into a chip row on phones (the accordions are gone). Each research section is its own component with its own data hooks (`components/study/research/`), so it can move pages.
- Overview: the company brief, Tauric's profile text, key statistics with their refreshed date (market value, beta and dividend yield also computed by Marsad and flagged when they differ beyond a stated tolerance; dilution, free cash flow margin and net cash from `investor-1`), the stock against SPY from 3M to 5Y (longer ranges disabled with the sessions they need), peers among tickers Marsad tracks, the thesis card and any held position with its exit rules, then the Tauric AI thesis, labelled.
- Analysts: consensus and counts, "Mean target vs last close" with low, median, high and the analyst count (no upside headline anywhere), the target chart, the recommendation trend from `analyst_history`, Tauric's single next-quarter estimate. Per-analyst rows: not available (Benzinga add-on).
- Financials: Piotroski as "n of 9 tests passed" with every test (`piotroski-1`), and a 5-year, TTM and quarterly overview (`financials-overview-1`) with two charts. Earnings: dated events, the reported diluted EPS table and chart with year-earlier change (`eps-yoy-1`), 8-K item 2.02 links; estimates and transcripts not available. Technicals: one engine `technical-1` (n of m readings, indicator table, pivots, `levels-1` support and resistance), no gauge. Dividends: summary, cuts, history and the calculator (`dividend-calc-1`, 30% withholding by default). Ownership: Tauric ownership bar plus 13F, insiders and short data. News: the vendor's labels, counts under 30, coverage by week (`news-sentiment-1`).
- The chart gained 1M to All ranges, weekly and monthly candles, Bollinger Bands, overlay toggles, analyst targets and levels as lines.
- New SEC concepts for the facts job (current assets and liabilities, depreciation, investing and financing cash flow) fill in at its next run; until then those lines read "Data unavailable".

### Company research data from Tauric (2026-11-28, ADR 0047)

- New table `company_research`: per ticker, Tauric's analyst consensus (rating counts, 12-month targets, EPS), company profile (classification, valuation, margins, ownership, description), the Tauric AI thesis (narrative, drivers, risks, catalysts, open questions) and the earnings and dividend calendar (next earnings date with one EPS and revenue estimate, latest ex-date). Members read it; nobody writes it from the app.
- Every part is checked in core (`tauric-research-1`) before it is stored or shown: finite numbers, whole counts that add up, targets ordered low to high, dates and times valid. A bad part is rejected with its reason and the last good value stays, with its own date.
- Job `tauric-research` runs daily at 09:35 UTC (Tuesday to Saturday) for holdings and watchlists. It reads the day's credit use first (free), spends at most 300 of the 3,000 daily credits, keeps 300 for quotes, warns at 80%, and logs every ticker's outcome in the job log. A ticker Tauric does not carry (BBAI, for example) costs nothing and reads "not covered".
- Waits for the `TAURIC_API_KEY` secret like the quotes job. Recorded fixtures for NVDA, AAPL and BBAI.
- Not available from Tauric: per-analyst ratings, earnings-call transcripts, segment revenue, reported EPS and surprises.
- New table `analyst_history`: a trigger keeps one row per ticker per day of the analyst counts and targets, so the recommendation trend builds from today. Per-analyst rows and track records need Massive's paid Benzinga add-on (not on the current plan, checked 2026-11-28).

### Quick look shows position, performance and a short company brief (2026-11-27)

- Tapping any ticker now shows three new sections under the header:
  - **Your position**, shown for open holdings only: value, gain, weight, stop bar, thesis, exit rules and horizon.
  - **Performance**: 1M, 3M and 1Y returns against SPY and the sector fund, the 52-week position, ATR %, rank, volume, revenue and net margin.
  - **Company brief**: what the company does, the top strengths and risks, sentiment, the latest report and the next earnings estimate.
- The extra data loads only when the quick look opens and shares the Study page's cache.
- The next-earnings estimate now comes from the stored results 8-Ks, as it does on Study.
- **Known issue (existing):** a ticker link inside a modal sheet (the Journal trade card, phone sheets) opens a quick look that the sheet blocks.

### Regime squeezed (2026-11-27, Khaled: squeeze Regime too)

- One summary card first: six one-line rows (the label and its run, the recession filter with n of 5 signals on, Fear and Greed, the capitulation watch with n of 4 conditions, the leading and lagging sector against SPY over 1 month, GPR and EPU percentiles). Each row opens its detail and moves focus there. The past-year ribbon sits under the rows; "Why this label" with the day's reason sits beside them.
- The ten detail cards now live in two switchable areas. Risk gauges: recession filter, Fear and Greed, capitulation watch (with its plan, exits and bear case), breadth. Context: what the S&P did next, sector rotation, geopolitics, the quality screen, more measures. The choice is remembered on the device.
- Nothing is dropped: every number, rule, source line, data date and "About this data" stays one tap away. The summary rows use the same stored rows and core functions as the cards; a missing input reads "Data unavailable", and a percentile from under a year of data says how many days it rests on.

### Status and Settings squeezed (2026-11-27)

- Status opens with a Now card: sources healthy and the ones that need a look by name, the heartbeat, the scheduler, this month's cost, the latest system alert. Each row scrolls to its detail.
- Healthy sources are one short row each (tier, latency, both clocks and note one tap away); stale or unavailable sources keep their full card and note.
- Jobs, costs, system alerts and alert latency share one switchable area, remembered on the device.
- Settings has four sections under one switch: display and security, notifications (with push setup), Shariah and AI caps, quote source and exports. Sections are only hidden, so an unsaved edit survives a switch; every form saves the same columns as before.
- Lab and Alerts unchanged: no boxes there duplicate each other.

### Watch squeezed (2026-11-27, Khaled: merge, squeeze and summarize)

- The four cockpit tiles are now four one-line rows in one Today card: regime, movers, today, exit rules. The full pre-market brief folds behind "Read the full brief".
- News and the calendar share one card with a switch. So do sectors, movers and gaps, which also replaces the phone-only movers card.
- The chosen view is remembered on the device. Nothing is dropped; every view is one tap away.
- Not done: an AI-written summary. `groundedGenerate`, with its number checks and template fallback, is already in core, but it needs the Anthropic key and the AI caps (paid), which are not set.

### Study squeezed, with a company brief (2026-11-27)

- New card under the company header: the company brief (core `companyBrief`, formula `company-brief-1`, no AI). It covers what the company does (the first sentence of the stored 10-K business section, as filed), market value, 1M, 3M and 1Y returns beside SPY and the sector fund, revenue, margin, free cash flow, dilution and the strength rank. It also has rule-based strengths and risks, each line with its rule, threshold and date ("Code-based checks, not advice"), stored news sentiment counts (no percentage below 30 stories), insider net buying over 90 days and the short interest trend. A context block gives the regime, the sector fund against SPY and recession signals, says Marsad does not forecast, and links to Regime. The last block covers the newest 8-K, 10-Q or 10-K, the 10-Q risk factor flag, next earnings (estimated), next ex-dividend and halts or alerts in 30 days. Missing inputs say Not available.
- Layout is now header, brief, chart, then one tab area. News and Filings are tabs; the snapshot tiles sit at the top of Financials. Each brief block opens its tab in one tap.
- The sector fund is the one set on the watchlist or a holding. Marsad stores no SIC code, so with none set the brief says so and does not guess.
- The brief now reads the 10-K business section and the newest 10-Q's risk factor flag on page load, so two lazy-load tests changed. The risk-factor texts are still read only when opened.

### Weekly Portfolio tile and scheduler line (2026-11-27)

- **Weekly review Portfolio tile (`held-week-1`).** It covers holdings held over the whole week, valued at the same two closes as the SPY tile. Holdings bought or sold inside the week are left out and counted, so cash moving in or out never reads as a return. A missing close makes the tile read "Data unavailable".
  - Hand-checked core tests and a browser test.
  - No new table: closed holdings stay in history.
- **Arabic:** Khaled does not need page content in Arabic. The shell stays bilingual.
- **Checklist version:** rows and stored review inputs without a version are scored as checklist-1. A test covers it.
- **Status scheduler line:** a new line on Status reports the Supabase Cron dispatcher in words. It shows one of: no check recorded, the token missing from Vault, GitHub's error, starts accepted, or that the check itself is overdue.
  - Khaled's screenshot on 27 Nov at 15:38 ET shows halts stale since 12:08 ET. GitHub lists no workflow_dispatch runs from Supabase since step 11; every run since was GitHub's own timer.
  - The cause is still open. The new line will name it.

### Design follow-ups: checklist-2, quiet hours, horizon (2026-11-27)

- **checklist-2 (ADR 0046).** New trades and the Sahm ticket use the design's five checks. `trades.checklist_version` keeps every older trade on checklist-1, so no record is relabelled. Adherence scores each trade against the version it answered, with hand-checked tests.
- **Quiet hours and the daily push cap** are now editable in Settings. They are stored in `alert_preferences` (owner only, RLS tested) and read by the alert jobs over the defaults; a job test shows a saved window changing the decision. This replaces the wrong "Not built yet" note.
- **Holding horizon (Long term or Swing):** a pill on the position card, chosen under Edit holding.
- **Display:** ratios and multiples read "1.8×", as in the design.
- **Checks:**
  - Unit tests: 1,116 passed.
  - Playwright: 191 passed and 11 skipped. That includes the new assertions for checklist-2, quiet hours and horizon.
- **Still not done:**
  - Arabic for page content beyond the shell.
  - The weekly Portfolio tile, which needs stored daily portfolio values.

### Live news on Watch (2026-11-27, Khaled's go-ahead)

- Migration `20270101000000_realtime_news.sql` adds `news_articles` and `filings` to the `supabase_realtime` publication. It is additive and guarded, and row-level security still applies.
- Watch subscribes to new rows and refetches. The news card says "Live" only while the channel is subscribed; otherwise it shows when it read the list. Stories that arrive while the page is open are marked "New" for 60 seconds.
- Tests:
  - Unit test for the tag timing.
  - Browser test with a stand-in realtime socket: subscribe, insert, "New", then the tag drops after a minute.
- Not done: the Journal checklist wording. The design's five items are different checks, not a rewording of the stored ones, so relabelling would misstate past trades and alert checklists. This is waiting on Khaled's decision.

### Marsad v2 redesign (2026-11-27, PR #76)

- Built from the Claude Design handoff "Marsad v2" (Khaled: "full implement").
- **Foundation (ADR 0045).** Navy and Daylight themes as CSS variables. Arabic and right-to-left for navigation, page titles and notices; numbers keep their order. A second time zone. Display choices are kept on the device. v2 header with all eight pages, plus the session and clock chip and the footer notice. Shared v2 components live in `components/ui/kit.tsx`.
- **New route `/settings`.** Display, Notifications, Shariah aid, AI caps, Security, quote source and exports. The forms moved here from Status.
- **Pages rebuilt to the v2 layout.** Watch (cockpit, 9-item strip, watchlist, news, calendar, sectors), Study, Regime ("Why this label", event study, rotation), Alerts (list and detail split), Journal (KPI tiles, five sections), Lab (stage counts, list and detail), Status (sources grid, job strips, costs).
- **New core functions, each with known-answer tests.**
  - Watch news ranking: `impact-1`.
  - Regime sector rotation against SPY: `sector-rotation-1`.
  - Study snapshot: `snapshot-1`.
  - Lab rule text: `rule-text-1`.
  - Alerts gap to stop: `gapToStop`.
  - Journal review-week SPY return: `weekReturn`.
- **Shown as unavailable rather than invented.**
  - Realtime news and the "New" tag: needs `news_articles` and `filings` in the realtime publication, a migration.
  - "Price move since" in the impact score: Marsad stores end-of-day prices only.
  - Put/call: needs an options data plan.
  - Quiet hours and the daily push cap: need a column and a job change.
  - Holding horizon (Long term or Swing): not stored.
  - The weekly Portfolio tile: needs stored daily portfolio values.
- **Checks.** Prettier, tsc and ESLint are clean. Unit tests: 1,108 passed. Playwright: 186 passed, 11 skipped, plus a test that loads every page in Daylight and Arabic with no sideways scroll and passes the axe scan.

### PR #74 merged; weekly review tiles (2026-11-27)

- PR #74 merged into main after CI passed (check and edge-core green on 2385c78, once Khaled cleared the GitHub billing lock).
- Weekly review: the design's tiles (Trades closed, Plan followed n of m, Mean result in R) computed by core `weeklyTiles` from the stored review inputs. The design's Portfolio and SPY week tiles are left out: Marsad stores no daily portfolio values.

### Event study 90% intervals (2026-11-27, Khaled's go-ahead)

- `event-study-2` (ADR 0044): a 90% percentile-bootstrap interval of the median for each condition and horizon with at least 30 episodes (2,000 resamples, seed 1, replayable). Known-answer test against a numpy reference to 1e-12.
- Migration `20261231000000_event_study_ci.sql` adds `ci_low` and `ci_high` to `regime_event_stats`; the regime job fills them on its next run. Until then rows fall back to the middle half, labelled as such.
- Regime shows "Median and 90% interval" and "90% interval a to b" where the interval exists. Most labels still have fewer than 30 episodes in 10 years of S&P 500 data, so they keep saying "Insufficient history".
- Checks: Prettier, tsc, ESLint, 1,072 unit tests, Playwright 177 passed and 11 skipped; the Edge copy passes `deno check` and the Node and Deno parity run locally.

### Council leftovers (2026-11-27)

- Lab on phones matches the design: lifecycle stepper with a "not in the lifecycle yet" line, All / Testable / Not testable tabs, and the playbook summary in its details.
- Journal Trades and Weekly review match the design: adherence ring (mean score; "followed the plan" is 80 or more, the line the result comparison uses), compact rows with Followed plan or Broke plan, By setup notes, the full trade card in a sheet, the log form behind a button; the weekly review gets its header and numbered notes. The design's four weekly tiles need structured data the review job does not store yet.
- Universe strength rank (ADR 0043, formula `strength-1`): the breadth job ranks the newest universe by 63-session return into `strength_rank_daily` (additive migration `20261230000000_strength_rank.sql`, RLS tested). Watch's trader columns and the quick look show "Beats n%".
- Sector strength: "Edit list" lets each ticker take a sector fund (`watchlist_items.sector_etf`); Watch then shows strength against it.
- Checks: Prettier, tsc, ESLint, 1,069 unit tests, Playwright 177 passed and 11 skipped.
- Still not built: the one-read nightly summary for the whole Watch page (Watch still reads each ticker's bars for sparklines and ranges).

### Council batch 4: investor toolkit (2026-11-27)

- Core `investor.ts` (formula `investor-1`, hand-checked tests, point in time): free cash flow (operating cash flow minus capital spending), stock-based pay and its share of revenue, buybacks, diluted shares against a year earlier, net cash (cash plus short-term investments minus both parts of debt), and with the close: market value, enterprise value, EV / sales, EV / operating income, price / free cash flow and free cash flow yield. Multiples on negative earnings or cash flow show "Not meaningful".
- The facts job now also stores capital spending (two tags: NVIDIA moved off `PaymentsToAcquirePropertyPlantAndEquipment` after 2020), stock-based pay, buybacks, short-term investments and the current and non-current parts of debt. The new figures appear after the next SEC facts run (weekdays 06:15 UTC) once this is merged; until then they read "Not reported".
- Study, Financials: a "Cash, value and dilution" section and a ten-year table of revenue (with bars), EPS and free cash flow, missing years marked.
- Kept as the design draws it: Earnings history stays its own section (the design has separate Financials and Earnings accordions), so it is not merged into the Financials table.
- Checks: Prettier, tsc, ESLint, 1,066 unit tests, Playwright 177 passed and 11 skipped. The facts-job test now expects 240 stored rows from the recorded NVIDIA file (the 16 capital-spending rows are kept on purpose).

### Council batch 3: trader toolkit (2026-11-27)

- Core `trader.ts` (formula `trader-1`, hand-checked tests): ATR 14 as % of the close, stretch from the 20- and 50-day averages in ATRs, 63-session relative strength against SPY (and a sector fund when given), distance from the 252-session closing high, calendar days to a date.
- Watch: a remembered "Trader columns" toggle (off by default, so the table matches the design) adds ATR %, stretch (50-day), strength against SPY, distance from the high and days to estimated earnings.
- Watchlist editing: "Edit list" adds, removes and reorders tickers; each change saves at once through row-level security. The first edit saves the tickers already shown, so nothing is dropped. At most 40 tickers; a new ticker gets prices after the next nightly bars run.
- Quick look: ATR %, stretch (20- and 50-day), strength against SPY, and "Add to watchlist" (or "On your watchlist"). Phone watchlist rows open the quick look from their expanded panel.
- Checks: Prettier, tsc, ESLint, 1,058 unit tests, Playwright 177 passed and 11 skipped (new `trader.spec.ts`).
- Not yet: strength against the sector fund on Watch (needs each ticker's sector), and a rank in the 1,000-stock universe.

### Council batch 2: say less, show more (2026-11-27)

- "About this data" (`apps/web/src/components/Info.tsx`): 33 method and source paragraphs across Watch, Regime, Study, Journal, Alerts, Lab and Status now sit behind one tap. Freshness words, as-of dates, "estimated", case counts, disclosure lags and bear cases stay visible; the notes that carry a lag or a filing date (13F, insiders, Financials, N-PORT) stay open.
- No repeated facts in the alert card: on a phone the sheet title is the headline (no second copy), and where a visual draws the risk or the checklist, its sentence is for screen readers only.
- Company news shows reporting first (tier 1 or 2, not opinion), grouped by day; opinion and tier 3 or 4 sit behind "Show opinion and tier 3 or 4 (n)".
- Status splits into Health (sources, jobs, system alerts, costs, latency) and Settings (notifications, quote source, preferences, exports).
- Kept as the design draws it, where the council differed: the Watch brief hero and tiles, and Study's accordions instead of sticky tabs.
- Checks: Prettier, tsc, ESLint, 1,050 unit tests, Playwright 173 passed. Tests that read method text now open "About this data" first (`openInfo` helper); a test checks the quick-look price keeps its freshness word.

### Council batches 1 and 5: tap any ticker, refresh rules (2026-11-27)

- Ticker link and quick look (`apps/web/src/components/QuickLook.tsx`): a ticker in Watch movers, gaps, news and Agenda earnings, the alert card, Journal holdings and trades, and ETF look-through opens a quick look. It is a sheet on a phone and a side panel from 760 px, so the list stays visible; Escape or the close button shuts it. It shows the last close with its day change and freshness, the Tauric price if chosen (never "Live"), a three-month chart with the 50- and 200-day lines, trend, RSI 14, the 52-week range, distance from the high, volume against 20 days, dollar volume, the estimated days to earnings, why it is here (your holding with stop, targets and thesis, or the latest alert), the two newest filings, and "Open full study".
- Saved watchlist tickers now get daily bars from the nightly job (valid symbols, at most 40 a night; workflow timeout 30 minutes).
- Refresh rules (ADR 0042): queries stay fresh 30 minutes instead of 10 seconds; quotes poll once a minute only in the regular session. Pull to refresh still reloads everything.
- Checks: Prettier, tsc, ESLint, 1,050 unit tests, Playwright 173 passed and 11 skipped (new `quick-look.spec.ts`).
- Left for later: the nightly per-ticker summary table (one read for Watch and the quick look), "Size a trade" and "Add to watchlist" in the quick look (need watchlist editing, batch 3), ATR %, stretch and relative strength (batch 3), headlines in the quick look (filings only for now), and ticker links in Lab, insiders and the alert list rows (the whole row is already a button).

### Phone design match against the Claude Design handoff (2026-11-26)

Each page was rendered from `design_handoff_marsad_redesign/mobile/*.dc.html` and compared side by side with the app at 390 x 844 (Playwright, isMobile and hasTouch, temporary config deleted after each run).

- Journal: summary carousel with dots, pill tabs with More (Options, Trades, Weekly review), holding cards with the stop-to-target bar, triangle gain, Stop hit, Target hit and Rotate to ETF flags, CSV import behind a button. New trade has 01 Prices, 02 Size, 03 Checklist and a pinned copy button. The Sahm ticket now reads `BUY 125 RKLB LIMIT 24.15 STOP 22.15 GTC` (core test updated). Exposure and ETF look-through use the design's bars. Options cards show name, legs, days left, a loss-to-gain bar and breakeven; details sit in a sheet.
- Watch: brief hero ("Pre-market brief · Wed 25 Nov", Emailed chip, tiles), market tiles with inline sparklines, and the Agenda list by day with Macro and Watchlist tags.
- Regime: hero with three tiles and the labelled ribbon, "What the S&P did next" rows with dashed 30-tick insufficient boxes, and context sections as collapsed rows with a value.
- Study: on phones the chart comes first and the tiles follow.
- Alerts: list cards with Pushed or In digest, the design time line, "Sent 4" tabs, scorecard boxes per rule under 30 cases, per-alert tiles, and a New scenario button.
- Status: the checked line reads "Checked 03:48 ET · 11:48 Riyadh". Sign in already matched.
- Checks: Prettier, tsc, ESLint, 1,046 unit tests, Playwright 170 passed and 10 skipped.
- Not matched, and why: the event study shows the middle half, not a 90% interval (the stored study has no bootstrap bars; adding them needs a job change and a migration, waiting for Khaled). No company names in watchlist or Study rows (not in the data). The Shariah tab has no filing reference or dollar figures. Trades and Weekly review keep their current layout. Option bar fills are lighter than the design so the labels meet WCAG AA. CI is blocked by the GitHub billing lock until Khaled clears it.

### Phase 1 session 1 (2026-11-23): what exists

Pure core (`packages/core`, 138 tests): timestamps (s/ms/us/ns), market calendar and session state (recorded Massive holidays), provenance and session-aware freshness, indicators (pandas golden values at 1e-9, mutation-checked), Nasdaq halts and GPR parsers (recorded fixtures), HTTP layer (token bucket, cache, retry, entitlement classification), identity and splits (vendor adjustment factors reproduced), feed health with transition-only system alerts, job run wrapper, Massive/FRED/SEC adapters, cross-source reconciliation.

Database (additive migrations, RLS tested, 16 tests): instruments, instrument_tickers, splits, market_holidays, gpr_daily.

Jobs: `jobs/` runs the GPR job (download, convert with `xlrd`, validate, upsert, run record, source status). Dry-run on the real file: 15,302 days, none skipped, 0.5 s. Workflow `.github/workflows/gpr-daily.yml` needs the secrets `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (SETUP step 5). Not yet run against the live project.

Web: Status page judges each source with the core policy and says why in words.

### Verified live (2026-11-24)

- PR #5 merged (`539b1ee`); the GitHub integration created `instruments`, `instrument_tickers`, `splits`, `market_holidays` and `gpr_daily` within about 30 seconds (anon REST returns 401 on each).
- First two GPR runs failed for two reasons found from the job logs: `SUPABASE_SECRET_KEY` secret missing, then `SUPABASE_URL` secret not a valid URL (re-entered by Khaled). Third run succeeded: `gpr-daily: ok, rows 15302, 22115 ms`.
- Khaled's Status page screenshot (2026-11-24 11:14 ET) shows: Geopolitical Risk Index "OK, last message 1m 6s ago (limit 4d 0h)", plan tier end-of-day, latency 21481 ms, note "Latest value 2026-11-23"; job run `gpr-daily` OK with 15302 rows. FRED shows "No data received yet"; Massive, Nasdaq halts and SEC show "Calendar not loaded, cannot judge", which is the intended behaviour until the calendar job fills `market_holidays` (needs the Massive key). This closes the Phase 0 follow-up "Status page screenshot".
- Tooling note: Claude cannot read or set GitHub secrets (the proxy blocks that API, correctly); everything else on Actions, including starting workflows and reading logs, works from a session.

### FRED job (2026-11-24, awaiting merge and first live run)

`jobs/src/fred-job.ts` fetches all 12 FRED series from 1990 and stores them in `fred_observations` (new migration), one run record per run, source status live only when every series succeeded. Workflow `.github/workflows/fred-daily.yml` (23:30 UTC daily) needs the secret `FRED_API_KEY` (Khaled added it; Claude cannot read secrets, so the first run proves it). Tests use synthetic FRED bodies; the first live run logs the newest three values of each series (public numbers) so real values can be checked and a real fixture recorded.

### Massive jobs (2026-11-24, live)

- `jobs/src/massive-reference-job.ts`: market holiday calendar (`market_holidays`) and split history (`splits`) for the 10 watchlist names and SPY, QQQ, IWM, DIA; run at 05:30 UTC by `massive-reference.yml`. Uses its own source row `massive_reference` (daily limit), so the Status page does not judge it by the live-price limit. A plan problem is reported as "Requires a higher Massive plan".
- `jobs/src/reconcile-job.ts`: nightly check of Massive Treasury yields against FRED (10-year, 10y-3m and 10y-2y spreads) for every date both published; mismatch, or nothing to compare, fails the run (`reconcile-nightly.yml`, 00:45 UTC).
- Adapter `fetchTreasuryYields` and a recorded fixture `fixtures/massive/treasury-yields.json`. Tests (jobs 14, core 141) use the recorded Massive rows.
- Unconfirmed until the first live runs: Massive base URL (`https://api.massive.com`), the REST envelope, and the entitlement error body. The first run's log shows any of these failing, and `docs/DATA_SOURCES.md` gets updated from it.

### SEC job (2026-11-24, live)

`jobs/src/sec-job.ts` looks up the CIK of each of the 10 watchlist stocks in the SEC ticker file, stores them in `instruments` (unique by CIK) and stores each company's recent filings in `filings` (new migration, RLS tested). Runs twice an hour on weekdays (`sec-filings.yml`) with the `SEC_USER_AGENT` secret (Khaled added `Marsad research` plus a contact email; Claude cannot read secrets, so the first run proves it). The adapter refuses to run without a name and contact email, per the SEC's page (reviewed 2026-11-20). The `sec_edgar` status limit was loosened to 2 hours in sessions because this job is not a once-a-minute poller; Phase 5 tightens it. Tests use synthetic bodies in the SEC's documented shapes (10 tests across adapter and job); the first live run is the real check, including that the SEC accepts the User-Agent.

### First live runs after merging PR #8 (`839e9b2`), 2026-11-24

- `massive-reference` (run 45443118940): ok, 33 rows (24 calendar rows, 9 splits for 14 tickers), 121 s (the free plan's call spacing). Confirms live: base URL `https://api.massive.com`, `Authorization: Bearer` auth, the holiday and splits endpoints, and the bare-array / `results` envelope parsing. The entitlement error body was not exercised (nothing was denied).
- `sec-filings` (run 45443124013): ok, 8,174 filings for the 10 watchlist companies (NVDA 1005, RKLB 654, MARA 1002, SOFI 985, HOOD 1005, OKLO 516, IONQ 636, HIMS 1001, RGTI 656, BBAI 704), 14.5 s. The SEC accepted the declared User-Agent.
- `reconcile-nightly` (run 45443576867): ok, 15 checks over 2026-11-16 to 11-20 (Massive vs FRED 10-year yield and both spreads), all within tolerance, 0.9 s.
- Sources now live: GPR, FRED, Massive reference data, SEC EDGAR, Nasdaq halts. Not yet: live Massive prices (Phase 5).

### Halts job (2026-11-24, live)

Khaled approved polling the Nasdaq trade-halts feed (yes, 2026-11-24). `jobs/src/halts-job.ts` stores every halt in `halts` (new migration, RLS tested), keyed by symbol and halt time, counts active and news-related halts, and runs every 5 minutes around US trading hours (`halts.yml`). A page that is not the feed (even with HTTP 200) or unreadable items are errors, never "no halts". The `nasdaq_halts` status limit is loosened to 30 minutes until Phase 5's 30-second poller. Tests use the real recorded feed (6 tests); the first live run is the live check. Alerts on halts (T1 news-pending in particular) are Phase 5.

First live run after merging PR #10 (`bcaa7d5`): `nasdaq-halts` (run 45445920963) ok, 57 halts stored (12 active, 0 news-related active), 1.5 s. The Nasdaq feed parser and job work on the live feed; the schedule is every 5 minutes from GitHub Actions (which can run late) until the Phase 5 30-second poller.

### Phase 1 session 2 (2026-11-24, merged as PR #12, `af6811a`)

All 14 Phase 1 checklist items are done. The brief's three finish criteria: (1) every indicator passes its fixtures (pandas golden values at 1e-9; `./init.sh` 213 tests plus 17 database tests and 8 e2e tests pass); (2) the Status page shows each source with last update, latency and plan tier (live for GPR, FRED, Massive reference data, SEC EDGAR and Nasdaq halts; the live-price source `massive` honestly reads "No data received yet" because its feed needs a paid plan and arrives in Phase 5); (3) a simulated stale feed raises one system alert (core test reproduces the brief example; the job test checks the alert, paused rules and stored snapshot).

Live runs after the merge (all from this session, with exit codes read from the logs):

- Migration `system_alerts` applied by the Supabase integration within about 30 seconds (anon REST 404, then 401).
- `health-check` run 45450173518: ok, 5 sources ok, 1 never reported (`massive`), 0 alerts.
- `reconcile-nightly` run 45450479006: ok, 18 checks (yields, spreads and 3 VWAP sessions) within tolerance. The first attempt (45450189469) failed with a Massive 429 because I started the fixture recorder at the same moment; the free plan allows about 5 calls a minute across all workflows, so Massive workflows must not overlap.
- `record-fixtures` run 45450180410: recorded real FRED, SEC and Massive bodies. Saved under `fixtures/` and tested in core: the Massive not-entitled error (HTTP 403, `NOT_AUTHORIZED`), the Massive REST envelope, FRED including `.` on Veterans Day, SEC submissions with 8-K items, and a full SPY minute day that rebuilds the vendor VWAP within +0.008%.

What changed in this session: 1.13 heartbeat and `system_alerts` (every 15 minutes in trading hours, every 3 hours otherwise; a calendar that does not cover today fails the run loudly); 1.14 Deno verification (the unchanged core fails under Deno, the generated copy passes `deno check` strict and gives byte-identical output, CI job `edge-core` green); 1.10 VWAP reconciliation (a typical-price VWAP was measured up to 0.41% off on five real sessions, so minute `vw` is used); real fixtures replace the synthetic bodies. A mistake of mine, caught by CI: I changed the Status page and did not run the Playwright suite, so the e2e test failed on GitHub; fixed, and I now run `pnpm e2e` before pushing UI changes.

### Phase 2 session 1 (2026-11-24)

- PR #14 merged (`ed8cdaf`): filings knowledge (all 33 8-K items from the SEC form), news tiers and clustering, the AI number verifier and orchestration (planted wrong number: rejected twice, then the template), cost caps, ADR 0007, the `daily_bars` table and job, one shared `massive-api` concurrency group for every Massive workflow.
- Live: `massive-bars` run 45454512012 ok, 14 tickers, 7,000 rows in 146 s. The free plan returns two years of daily bars (500 for NVDA).
- Free-plan entitlement tested with real calls: short interest, short volume and dividends work; income statements and Benzinga earnings are not entitled (DATA_SOURCES.md).
- Study page (this batch): `/study` and `/study/$ticker` with summary, chart, event markers, filings timeline and "requires plan" placeholders. 13 e2e tests, one of which loads the page under the real production CSP.
- Finding: TradingView Lightweight Charts injects an inline `<style>` for its attribution logo, which the strict CSP blocks. `vite preview` does not apply `_headers`, so no existing test would have caught it. Fixed with a hash-pinned `style-src` entry and a permanent test (ADR 0002).
- Blocked on Khaled for the AI features: `ANTHROPIC_API_KEY` and approval of the proposed caps (ADR 0007).

### Phase 2 data layer is live (2026-11-24, PR #16 merged as `a4c028b`)

All four new jobs ran once by hand after the merge and succeeded: `sec-facts` 10,126 facts for 10 companies in 19 s; `massive-news` 392 articles in 136 s; `sec-insiders` 80 Form 4 filings read and 199 transactions stored in 46 s (80 is the per-run limit; the backlog clears one hourly run at a time); `massive-study-data` 322 short interest rows, 1,190 short volume rows and 85 dividends in 8 minutes. The heartbeat then registered 8 sources ok.

### Finding: GitHub's scheduler has barely fired (ADR 0008)

The heartbeat raised two real alerts (`nasdaq_halts` and `sec_edgar` stale in the regular session). The run history shows why: in the whole repository exactly one `schedule` run has ever fired (GPR daily, 11.5 hours late); the 5-minute halts cron, the 30-minute SEC cron and the heartbeat's own 15-minute cron fired zero times in one to two hours. Every earlier verification was a manual run. Earlier reports that said these jobs "run every 5 or 30 minutes" were not verified and are withdrawn. Marked as checklist item 1.15 (todo) and proposed in ADR 0008: trigger the workflows from Supabase Cron through `pg_net`, which needs a fine-grained GitHub token that only Khaled can create.

### Study page panels (2026-11-24, this batch)

Financials (as filed, point-in-time date picker, derived quarters marked), insider transactions (explained codes, 10b5-1 box, totals, unreadable filings admitted), short interest and short volume (with definitions and lag), news (clustered, tiered, opinion-labelled) and dividends, each loading on its own so one failing table cannot blank the page. 19 e2e tests, every mocked row built from the real recordings. Found while looking at the rendered page: `toFixed` rounds a written half down (81.615 became "$81.61B"), fixed in core with `toFixedHalfUp` and tests; numeric table headers were left-aligned over right-aligned numbers because `text-start` and `text-end` conflict (also fixed on the Status page); a missing figure said "Not enough history" where the right words are "Not reported". Fiscal-year gaps in a screenshot come from the 16-newest-rows trim of the test fixture, not from the stored data.

### Earnings history (2026-11-24, checklist 2.6 done)

`packages/core/src/earnings.ts` and the "Earnings history" panel on the company page. Each reported quarter is joined to its results 8-K (Item 2.02) and the stock's move is measured in the first session that could trade on it, from the close before. Release time is the SEC acceptance time in ET (before the open, during the session, after the close), never the 10-Q date. A release with no 10-Q yet is listed on its own so the latest reaction is not hidden. Estimates, surprise, guidance and the implied move are shown as "requires a higher Massive plan" or "needs options data".

Verification: 26 core tests with hand-checked arithmetic and ET time edges (09:29:59, 09:30:00, 15:59:59, 16:00:00, winter and summer), each branch mutation-checked, Node and Deno output byte-identical (strict `deno check` passes), one e2e test on the page with a screenshot reviewed. `./init.sh` exit 0 (413 tests), `pnpm e2e` 20 passed.

Two design bugs were found by checking, not by the first tests. Same-day releases were ordered by accession number instead of acceptance time. A prior-year quarter repeated in a later filing carries that later "filed" date, which let it take the newest quarter's release (the real NVIDIA facts do this), so matching now uses the latest quarter that ended before the release, at most 95 days earlier. The panel also loads its own 8-Ks: the page's filings list keeps only the newest 200 rows, which for a company with many Form 4s can span a few weeks.

Limit stated on the page: only 8-Ks the SEC job stored are used (the `filings.recent` list), so quarters older than about a year say "No results 8-K stored for this quarter" until older submission files are loaded (IDEAS.md).

### Risk-factor comparison (2026-11-24, checklist 2.5 in progress)

The company page has a "Risk factors, year over year (10-K)" panel that compares Item 1A of the two newest annual reports sentence by sentence, by code with no model. It loads the two reports (about 110 KB each) only when opened. Text comes from Massive's 10-K sections endpoint, which I confirmed works on the free plan with the project's own key (recorder run, real NVIDIA pair saved in `fixtures/massive/`). On that pair: 71 new, 49 removed, 66 edited, 449 unchanged sentences, including the new Groq licence risk, the dropped DGX Cloud risk and the rewritten China export-control text.

Why sentences: the plain text breaks pages in the middle of sentences, in different places each year, so paragraph comparison would report unchanged text as changed. Verification: 33 core tests, mutation-checked; every added, removed and changed sentence matches an independent Python implementation (hashes equal); Node and Deno byte-identical; job and adapter tests on the real response; 2 e2e tests; screenshot reviewed. The 0.6 "edited" cut-off is a default, not a standard: the edited count moves from 69 to 44 between 0.5 and 0.8 (the unchanged count does not move), stated in DATA_SOURCES.md and on the page.

Needs after merge: the new migration `20261127000000_annual_sections.sql` is applied by the Supabase integration (check with anon REST: 401 means the table exists), then the weekly job `massive-sections` has to run once by hand (Actions, Massive 10-K sections, Run workflow) before the panel has anything to show. Until then the panel says no annual report text is stored. Not done: 10-Q sections (the endpoint is 10-K only) and the Item 1 business text.

### Live: risk-factor data (2026-11-24, PR #19 merged as `44c7b32`)

- The Supabase integration created `annual_sections` (anon REST returns 401, the same as `job_runs`).
- First live run of `massive-sections` **failed**: `Sections failed: OKLO: Massive rate limit reached (rate-limited)`, recorded as an error run as designed. Cause: the shared request bucket started with 5 tokens refilling at 5 a minute, which sends about 9 calls in the first minute against the free plan's about 5; earlier jobs had survived on retries. Fix: a bucket of 1, so every call is 12 seconds apart (applies to every Massive job; their calls take slightly longer, none exceed the limit).
- Rerun after the fix: `massive-sections: ok, rows 19, 110074 ms`. NVDA 2026 and 2025; RKLB, MARA, SOFI, HOOD, OKLO, IONQ, HIMS and BBAI 2025 and 2024; **RGTI only 2025** (its panel will say there is nothing to compare). No company is missing from the vendor.
- Not looked at live: the panel itself needs Khaled's signed-in session; the end-to-end test renders the same real reports.

### Insider Forms 3 and 5 (2026-11-24, checklist 2.4)

The insider panel is now "Insider filings (Forms 3, 4 and 5)". The job reads all three forms and their amendments. I recorded real documents first: the 10 tracked companies list 263 Form 3 and 5 filings, and six of them are saved as fixtures (a mixed Form 3, a restricted-stock-only Form 3, a Form 3 stating the person owns nothing, a joint Form 3/A with four owners, a Form 5 and an amended Form 5/A).

Things the real data showed that I would not have guessed: a Form 3 can say outright that the person owns no securities (stored and shown as a fact); restricted stock units give no price or date as values, only footnotes (shown as "Not stated, see the filing notes"); an amended Form 5 filed in March 2025 reports sales made in December 2023 and June 2024 (so the panel now shows the filed date next to the trade date); amendments can repeat an earlier filing, so their lines are listed but not added to the 90-day totals; and Form 4 documents carry holdings rows too, which are now stored.

Verification: six real documents checked against an independent Python reading of the XML, parser mutation-checked (all caught), the totals function moved into core and mutation-checked (one equivalent mutant, since `0 + null` is `0` in JavaScript), a per-table access test for every Study table, Node and Deno byte-identical, 4 e2e checks on the page (screenshot reviewed). One existing test changed: the Form 4 job test now expects 16 rows, because it also stores the 3 holdings rows those two filings carry.

After merge: the Supabase integration applies `20261128000000_insider_holdings.sql` (additive). Form 3 history fills in as the hourly insiders job reads 80 filings a run, newest first. The job's candidate window grew from the newest 400 to the newest 600 filings and its "already read" check is now asked in chunks, because a few hundred accession numbers in one request would be too long. 13F holders stay a placeholder, now with the reason.

### Live: insider Forms 3 and 5 (2026-11-24, PR #21 merged as `74e9965`)

- The Supabase integration created `insider_holdings` (anon REST returns 401, same as the other tables; the new `insider_filings` columns come from the same migration file).
- First run of `sec-insiders` after the merge, started by hand: `ok, rows 279, 43582 ms, read 80 of 80 candidates`. It reads 80 filings a run, newest first, so older Form 3s and the rest of the 600-filing window fill in over the next runs. Not looked at on the live page (needs Khaled's signed-in session).

### Live results after the Phase 3 merges (2026-11-25, about 10:20 UTC)

- FRED workflow run by hand: regime ok (2,512 days, latest 2026-11-23 stress); calendar ok (20 events in 60 days, an earnings estimate for all 10 watchlist companies); the composite step failed loudly as designed ("3 of 7 components") until the breadth backfill and IEF bars exist. GitHub will email a failed FRED workflow each night until then.
- Breadth backfill (run 45588953591) running since 09:48 UTC; the topics backfill is queued behind it in the Massive queue.

### Weekly review from templates (2026-11-25)

- **ADR 0029** (`weekly-review-1`): each Sunday after the export, a review of the week's results and behavior (broken rules named), alerts, feedback and scorecard, written by code, stored as a brief, emailed when Resend is configured, and shown on the Journal page. The Opus prose waits for an Anthropic key.

### Cost tracker (2026-11-25)

- **ADR 0028** (`costs-1`): the Status page lists every plan's monthly cost (all USD 0 today), AI spend against caps Khaled sets in Preferences (blank caps keep AI off; warning at 80%, templates at the cap), and GitHub Actions minutes estimated from the job log.

### Live data after the breadth backfill (2026-11-25, 11:53 UTC)

- Breadth backfill (run 45588953591) succeeded in 2 h 4 min; the sentiment step then computed 3,240 days. Fear and Greed composite: 4, extreme fear, on 2026-11-23 from 4 of 7 components (476 breadth days, 501 SPY bars, no IEF bars yet). Capitulation watch: off on 2026-11-24.
- Topics backfill (run 45591767980) succeeded, 11:53 to 12:00 UTC. Bars job (run 45609668241) succeeded, 12:00 to 12:06, now including IEF, GLD, ITA, IYT and the 11 sector ETFs; its new steps ran on live data: `alerts-exits` ok (0 holdings yet), `scorecard` ok (0 alerts yet).
- FRED workflow (run 45611030574) green on every step for the first time: regime stress on 2026-11-23 (recession filter elevated, 2,512 sessions); Fear and Greed composite 4, extreme fear, from 5 of 7 components (the bond component now has 501 IEF bars); capitulation watch off on 2026-11-24; calendars 20 events, next GDP on 2026-11-25. The nightly failure emails stop.
- Open for Khaled: Dependabot PR #40 (5 GitHub Actions updates) is left for review rather than merged unread.

### Shariah screening aid (2026-11-25)

- **ADR 0027** (`shariah-1`): off by default; when switched on in Preferences (Status page), each company's Financials panel shows debt and cash over market capitalization or total assets against Khaled's limits, from the filings, with every caveat (business activity and non-permissible income are not screened; Sahm's label takes precedence).

### Weekly exports and alert latency (2026-11-25)

- **ADR 0026** (`exports-1`): each Sunday the `exports` job writes Khaled's personal tables and the rule library as JSON, with a hashed manifest, to a private bucket he alone can read (MFA); the Status page lists and saves them.
- The Status page shows alert latency by kind (median and 90th percentile, 30 days), in its own query so a failure there never blanks the page.
- The accessibility scan now renders sticky bars in normal flow, ending the intermittent target-size results under the tab bar.

### Thesis card (2026-11-25)

- **ADR 0025** (`thesis-1`): an append-only thesis card on every company page; the bear case and what would change the view are required by the app and the database; saving sets the status on open holdings of that ticker. The AI draft from cited sources waits for an Anthropic key.

### Redesign, step 1: Regime page and the navy palette (2026-11-26)

- From Khaled's Claude Design project "Market Watch Application" (Regime.dc.html): the navy palette is now the app-wide theme, and the Regime page leads with visuals (regime hero with input tiles and a year-long ribbon, recession signals with trigger ticks, capitulation condition tiles, Fear and Greed gauge with component bars, event-study interval bars by condition, breadth bars, geopolitics topic tiles with headlines). Every table, rule and source stays one tap away under "Show details".
- Wired to real data only. Correction to the design: the stored event study gives the median and the middle half of outcomes (25th to 75th percentile), so the bars say that, not a 90% interval. The design's sample-only "Preview: on" toggle is not used.
- Verified: Regime e2e 8 passed; full Playwright 142 passed (axe on every page); ./init.sh passes.

### Redesign, step 2: Watch page (2026-11-26)

- From Watch.dc.html: brief card with one tile per brief section and the email state; market strip tiles with 30-session sparklines; watchlist with a 1D/5D/1M period control (remembered in this browser), sort by change, sparkline, change pill, 52-week closing-range dot and volume bar (warn at 1.5x or more); tinted sector tiles; mover and gap bars (light: the gap, solid: what the close kept); news with ticker chips; one Calendar card with All, Economy and Earnings and an impact legend. A row whose last bar is older than the rest says so.
- Core: `tickerSummary` gains `range252` (lowest and highest close of 252 sessions and the position between them), with hand-checked tests. Card, Details, Tile, Segmented and Sparkline are now shared components (`apps/web/src/components/Card.tsx`), used by Regime and Watch. lucide-react added for icons.
- Not taken from the design: its sample numbers. (Correction, step 3: news stories now carry the source tier and the opinion label, from the same `clusterNews` result the Study page uses.)
- Verified: ./init.sh passes (1,004 unit tests); full Playwright 142 passed with axe; web build ok.

### Redesign, step 3: phone shell (2026-11-26)

- From MobileShell.dc.html. Under 760 px: a compact top bar (page title, market-state chip, freshness dot with a count in words), a bottom tab bar with icons (Watch, Study, Regime, Alerts, Journal, More), and sheets for More (Lab, Status, Sign out) and for the market (ET and Riyadh clocks, session, next regular open, stale or unjudged sources). Pull to refresh refetches every query on screen and says "Updated HH:MM ET". Safe-area insets on both bars.
- At 760 px and up: one top bar with the bilingual logo, all seven tabs, the market chip, the clock (ET only below 1280 px; the market sheet has both) and Sign out. The old bottom bar is gone on iPad and desktop.
- Market state and freshness come from `sessionInfo` and `describeSourceHealth` (the Status page's rules); a missing holiday calendar says "Calendar not loaded" instead of guessing, and no source rows say "No source status yet", never "All fresh".
- Shared `Sheet` (native modal dialog: focus kept inside, Escape and backdrop close) and `ScrollX` (keyboard-reachable sideways scroll for wide tables).
- Verified: ./init.sh passes; full Playwright 150 (146 run, the 4 phone tests run once) with axe; new e2e/mobile-shell.spec.ts at 390 by 844 covers the tab bar, More, the market chip and sheet, a holiday, and pull to refresh.

### Redesign, step 4: Watch on phones (2026-11-26)

- From Mobile-Watch.dc.html, under 760 px: the page title moves to the top bar (the heading stays for screen readers); brief and strip tiles go two-up, sectors three-up; the watchlist is a list (ticker, sparkline, close, day change) whose rows expand to 1 day, 1 week and 1 month, the 52-week bar, volume and "Study NVDA"; movers and gaps share one card with Up, Down and Gaps; the earnings table scrolls sideways (keyboard-reachable). Skeleton cards replace "Loading". Phone cards use 16 px padding and radius.
- Shell fix: a long market label no longer squeezes the page title; the freshness text shows only when there is a count.
- Verified: ./init.sh passes; full Playwright 152 (147 run, phone tests once) with axe; new e2e/mobile-watch.spec.ts.

### Redesign, step 5: Regime on phones (2026-11-26)

- From Mobile-Regime.dc.html, under 760 px: the hero, then a swipe row of four gauges (Fear and Greed, recession filter, breadth, capitulation watch), each opening its full card (tables, rules, sources) in a sheet; the event study stays on the page; the geopolitical panel, quality screen and the three measure cards are collapsed under "More context". The page picks the layout by width (`useWide`), so no card is rendered twice.
- Fixed while testing: the gauge showed the stored composite unrounded (41.88); it now rounds the same way as the full card (42).
- Verified: ./init.sh passes; full Playwright 154 (148 run, phone tests once) with axe.

### Redesign, step 6: Study (2026-11-26)

- From Study.dc.html and Mobile-Study.dc.html. List: search first (filters as you type; Open looks up any ticker), then the starting stocks and benchmark ETFs as rows with a 30-session sparkline, close, day change and the estimated earnings date where the calendar job has one (one read for all sparklines).
- Company page: a header with ticker, name, last close, change and a freshness badge (sticky on phones); key tiles for the 52-week range, RSI 14 with its 30 and 70 zones, the trend and the two averages; the chart card with 3M, 6M and 1Y (long averages still drawn from full history), indicator chips and a marker lane with lettered circles and a legend. Sections: tabs on iPad and desktop (Overview, Financials, Ownership, Filings and risk, News), accordions on phones with the overview open first; closed sections load nothing. Range, indicators and section are remembered in this browser.
- Every Study panel now uses the card style and a pulsing placeholder while it loads.
- Not built from the design yet: the short-interest and next-earnings tiles on the company page, the Shariah chip in the list, and touch-and-hold crosshair on the chart.
- Verified: ./init.sh passes; full Playwright 156 with axe; Study tests open the right section first; new phone test for the accordions.

### Redesign, step 7: Alerts (2026-11-26)

- From Alerts.dc.html and Mobile-Alerts.dc.html: tabs Sent, Held back and All with counts (the old "show suppressed" box is gone; all 50 newest load once); rows with a priority bar, kind, priority badge, ticker, headline, decision and time in ET and local; the full card beside the list on iPad and desktop, in a sheet on phones. The pipeline's reasons show as chips; the bear case sits on an orange tint; feedback buttons stay at the foot. A push or email link (/alerts#alert-<id>) selects that alert and switches to All when needed. Empty state links to the Lab. Scorecard and catalyst scenarios use the card style.
- Not built from the design yet: the plan bar and per-horizon risk visuals (the stored card is text, so they need structured fields first), the 30-tick scorecard strip, and the 4-step scenario sheet on phones.
- Verified: ./init.sh passes; full Playwright 158 with axe; the alert test now opens the alert from its #alert- link; new phone test for the sheet.

### Redesign, step 8: Journal (2026-11-26)

- From Journal.dc.html and Mobile-Journal.dc.html: KPI tiles (portfolio value, open gain with percent on cost, beta to SPY with a 1.0 tick, needs attention); sections as tabs (Positions, New trade, Options, Exposure, Trades, Weekly review), remembered in this browser; every section in the card style. Each holding has the stop, now and target bar (orange to blue, cost and target ticks, a white "now" dot, an orange ring when an exit has triggered). On phones holdings are cards, not a table.
- Core: `portfolioTotals` (value, cost, open gain, gain on cost, unpriced holdings listed rather than guessed) with hand-checked tests. The KPI beta and the Exposure card share one positions builder, so they cannot disagree.
- Fixed: on a phone the long CSV header example made the whole page scroll sideways. Every phone test now checks the page is no wider than the screen.
- Not built from the design yet: thesis pill that cycles on tap, time-stop progress bar, the CSV drop zone with a duplicate preview, and the pinned Copy ticket button on phones.
- Verified: ./init.sh passes; full Playwright 160 with axe.

### Redesign, step 9: Lab, Status and Sign-in (2026-11-26)

- Lab (Lab.dc.html): lifecycle strip with counts (Draft, Backtested, Shadow, Live, Demoted) and "Not testable yet" and "Not run yet" in words; All, Testable and Not testable filter; playbook cards with number, status badge, horizon chip and a 4-segment evidence meter; a lock on not-testable reasons; sources and the rule one tap away; the left-out list with a ban icon.
- Status (Status.dc.html): a hero "N of M sources healthy" with one cell per source (state in words for screen readers and on hover, judged by the same policies as the table); every section a card whose table scrolls sideways in a keyboard-reachable region on narrow screens.
- Sign-in (SignIn.dc.html): a centred card from 760 px and a full-screen page on phones with the bilingual logo; white primary buttons; a 10-segment password meter (yellow until 10 characters, then blue) and an orange border with "The two passwords are different." when the confirmation differs.
- Not built from the design yet: Status job-run 24-hour strips and cost bars with an 80% tick, Lab equity curves (no stored report has them yet). The "sp.filter is not a function" crash mentioned in the handoff could not be found or reproduced in the current code.
- Verified: ./init.sh passes; full Playwright 160 with axe.

### Redesign leftovers, batch A: Status and Journal (2026-11-26)

- Status: a 24-hour strip per job with a tick at each run (blue OK, grey skipped, red error, yellow running; counts in words for screen readers) and the latest error text, from its own 24-hour read; AI spend bars against the daily and monthly caps with the 80% warning tick (only when caps are set). No bar for GitHub Actions minutes: the account's included minutes are not stored, so a limit would be a guess.
- Journal: the thesis is a pill that moves on one step per tap (intact, weakening, broken); a time-stop bar (sessions held of the limit); CSV import with a file picker, drop on the box, and a live preview where rows already stored are struck through and skipped; the Copy Sahm ticket button shows "(n of 5 checks)" and stays pinned above the tab bar on phones.
- Core: `sessionsHeld` (the time-stop exit now uses it, so the bar and the exit cannot disagree) and `markDuplicateHoldings`, both with hand-checked tests.
- Verified: ./init.sh passes; full Playwright 162 with axe.

### Redesign leftovers, batch B: Study (2026-11-26)

- Company page tiles: next earnings (estimated from the stored results 8-Ks with the same core function as the Watch calendar, with its range and an overdue flag) and short interest (latest settlement, days to cover, date; the same cached read as the Short panel).
- Chart: pointing at it, or touch and hold on a phone, shows the day and close ("Wed 25 Nov · 182.40"); the crosshair goes when the finger lifts.
- Study list: a Shariah chip (Within limits, Over a limit, Not checked) when the aid is switched on in Status, with a hidden "not a ruling" prefix for screen readers. The Financials panel and the list now share one helper (`lib/shariah.ts`), so they cannot disagree.
- Verified: ./init.sh passes; full Playwright 162 with axe; tests for both tiles, the chart readout and the list chip.

### Redesign leftovers, batch C: Alerts (2026-11-26)

- The alert detail now reads the stored input snapshot (rule 12) as well as the card text: the plan as a bar (stop, signal tick, target ticks, a white "now" dot) with reward-to-risk chips per target (core `rewardRisk`); risk by horizon as a loss-rate tick with its 90% Wilson interval from 30 cases up, otherwise "Insufficient history (n of 30)" or "Does not apply"; the checklist with ticks and crosses (the words are there for screen readers). The text card stays below each visual as the record.
- Scorecard: a strip of the last 30 alerts with a 1-session result (blue gained, orange lost, grey pending), counts in words for screen readers; the table keeps every horizon. 1 session rather than 5 because it scores first.
- Catalyst scenarios on phones: "Write a scenario" opens a sheet with four steps (Watch, Triggers, Plan, Review) and Save on the review step; iPad and desktop keep the inline form.
- With this batch every item on the redesign "not built yet" lists is done except the Lab equity curves, which wait until a stored backtest report carries curve data.
- Verified: ./init.sh passes; full Playwright 166 with axe; new tests for the setup alert visuals, the strip and the phone scenario steps.

### Tauric as a second quote source (2026-11-26, ADR 0041)

- Khaled asked for Tauric next to Massive with a one-of-two switch for live prices. Three independent reviews (architecture, data integrity, vendor terms) all said "go with changes"; the build follows their common conditions. Measured first: Tauric's 2026-11-25 closes equal Massive's to the cent (AAPL, NVDA, SPY), volume about 2% lower, delay for US stocks unpublished, and its own age field misleading (a 30-minute-old FX quote read 5 seconds).
- Fixed a real defect found by the review: a value of `unknown` plan tier was labelled "Live". It now reads "Delay not confirmed" with the delayed allowance, then "Stale" (known-answer tests).
- Built: Tauric adapter (`POST /v1/quotes`, batch of 50, own failure classes, POST support in the shared HTTP client), recorded fixture, `user_settings.quote_source` (per person, Massive by default), `price_quotes` (member-readable, job-written), `tauric` source row and health policy (pauses no rule), `tauric-quotes` job every 5 minutes in the session, nightly `tauric-reconcile` against Massive daily bars, Status radio card, "Latest (Tauric)" column on Watch and a line under the company price.
- Display only: bars, indicators, backtests, rules and alerts stay on Massive.
- Khaled added `TAURIC_API_KEY` the same day. First live `tauric-reconcile` (run 45847822729, manual): the key works; 10 of 14 closes equal Massive's; it failed on MARA, HIMS, RGTI and BBAI (Tauric does not carry them) and DIA volume (10.3% lower, close equal). Khaled chose to report both instead of failing; closes and session dates stay strict.
- Status page dates: the date beside an ET time was the UTC date (a day ahead from 19:00 ET); fixed to the ET date, found in Khaled's screenshot.

### Reliable scheduling from Supabase Cron (2026-11-26, ADR 0008 accepted)

- Khaled accepted ADR 0008 after the heartbeat (every 15 minutes) fired only 9 times in two days.
- Built: `private.dispatch_workflow` posts to GitHub's workflow_dispatch API through `pg_net` with a token from Supabase Vault; 26 Supabase Cron jobs copy every workflow schedule exactly (a database test reads the workflow files); `scheduler-check` writes a `scheduler` job run every 15 minutes (ok, error with GitHub's reply, or skipped until the token exists).
- Waiting on Khaled (SETUP step 11): enable `pg_cron` and `pg_net`, create a fine-grained GitHub token (Actions read and write, Marsad only) and store it in Vault as `github_actions_token`.

### Lab equity curves (2026-11-26, last redesign leftover)

- Every new backtest report stores `equity`: growth of 1 over the closed trades taken one after another by exit date (the convention of `maxDrawdown` and the Monte Carlo drawdowns), thinned to about 200 points while always keeping the lowest, highest and last. Labelled on the page as a sequence of trades, not a portfolio. Known-answer tests by hand.
- The Lab draws the out-of-sample curve only when the stored report has one (the design's rule); reports stored earlier show none until the weekly backtest runs again.
- With this, every item on the redesign "not built yet" lists is done.

### Sign-in, friends and keys (2026-11-26)

- Password sign-in live (ADR 0039); Set password workflow run #1 ok. Friends can create accounts (ADR 0040); Supabase: sign-ups on, email confirmation off, AAL1 session limit off; TOTP shows Disabled (not needed in password mode; re-enable when restoring the second factor).
- VAPID_PRIVATE_KEY secret added; the device is turned on from the iPhone next.
- First email sent: close recap 2026-11-25 (started by hand at 23:06 UTC because GitHub's scheduler ran about 9 hours late).

### Khaled's setup, step by step (2026-11-25)

- Email: RESEND_API_KEY and BRIEF_EMAIL_TO added as GitHub secrets (by Khaled's browser assistant); first real send is tonight's close recap.
- Supabase advisors read: no security errors; six unindexed foreign keys indexed (`20261225000000_fk_indexes.sql`); auth settings confirmed. Checklist 8.5 done.

### Live SEC run and the 13F CUSIP fix (2026-11-25)

- Weekly SEC data on main: quality screen ok (1,000 universe, 335 eligible, 13 passed); 13F holders ok for all 10 stocks (3,830,274 lines read); ETF holdings ok (SPY as of 2026-09-30, 504 lines, 376 matched; QQQ 2026-06-30; DIA 2026-07-31).
- The run showed filer-error CUSIPs counted for NVIDIA (another issuer's CUSIP, option codes, lower case). holders-2 (ADR 0037 addendum) keeps only CUSIPs on at least 1% of the lines and counts the rest; the job rereads the data set under the new version.
- The Status page's "Adapter arrives in Phase 1" note for live Massive prices is replaced by the real reason (Phase 5 plan).

### ETF overlap and look-through (2026-11-25)

- **ADR 0038** (`etf-1`): holdings of SPY, QQQ and DIA from their newest public SEC N-PORT reports, loaded weekly; the Journal shows the overlap between the funds and, for each stock held directly, the dollars also held through those funds, with the report dates and the N-PORT lag. Overlaps match an independent Python calculation on the real reports. Checklist 7.3 done; IWM not covered (multi-fund trust).

### 13F institutional holders (2026-11-25)

- **ADR 0037** (`holders-1`): each stock's institutional holders from the free SEC Form 13F data sets, streamed weekly, with the period, the 45-day lag, the top 20 filers and every CUSIP counted (Rocket Lab appears under two). Checklist 2.3 and 2.4 done.

### Quality at a discount and the 10-K business text (2026-11-25)

- **ADR 0035** (`quality-1`): a weekly screen of the Marsad universe from free SEC XBRL frames: quality (gross profits over assets, return on assets, low accruals, low leverage) and value (earnings yield, book-to-market) as percentiles; passing companies shown on the Regime page with every exclusion counted and every fallback figure named. Real frames recorded 2026-11-25.
- The company page shows the 10-K business description as filed, and each stock's 10-Q risk-factor updates with a quarter-over-quarter comparison (ADR 0036; extraction checked on four real filings).

### Options positions on the Journal page (2026-11-25)

- **ADR 0034** (`options-pos-1`): defined-risk options positions placed in Sahm are entered by hand with their exit rules and bear case; code shows the maximum loss and gain, breakevens, days to expiry and the result at expiry at the last close, flags the time exit and assignment risk, and says plainly that today's value needs option quotes.

### Telegram as the optional second channel (2026-11-25)

- **ADR 0033** (`telegram-1`): everything that is pushed also goes to Telegram when the bot secrets exist, with the same freshness rules; each channel claims its items separately, so one failing never silences the other. SETUP step 7 has the iPad steps.

### Email copies of critical alerts and the alert digest (2026-11-25)

- **ADR 0032** (`digest-1`): every critical push alert and system alert also arrives by email with its full card; alerts held back by quiet hours or the daily push limit are collected into one digest email after the pre-market brief and the close recap. Same once-only delivery claim as push; nothing older than 24 hours (copies) or 48 hours (digest) is mailed as news.
- **Verified**: 6 core and 8 job tests plus writer tests; unit suite all green.
- **Waiting on Khaled**: the Resend secrets (SETUP step 9) turn on briefs, copies and digests together.

### Web Push to the iPad Home Screen app (2026-11-25)

- **ADR 0031** (`push-1`): push alerts, system alerts (feed down and recovered) and briefs are queued as pending and sent by a dispatcher step at the end of every workflow that creates them (no new schedule, no extra runs). Keys are created on the Status page; the private key goes only into the GitHub secret `VAPID_PRIVATE_KEY`. Late notifications say how late; anything past its limit (2 hours for alerts) is recorded as not sent. Devices the push service drops are stopped and shown.
- **Verified**: 33 core tests (RFC 4648 vectors, age and late boundaries, endpoint allow list), 12 job tests (send once, claim race, expiry, missing secret, key mismatch, 410 disables a device, the SEC 2 P-256 generator point as a key vector), RLS test (owner only, known push hosts only), 3 browser tests on desktop and iPad (no request carries the private key; the browser's key pair matches what the job derives), and an offline check that web-push builds an aes128gcm request with our key.
- **Waiting on Khaled**: SETUP step 10 (add Marsad to the Home Screen, create keys, add the secret, turn on the iPad, run the test).
- **Live**: PR #45 merged; the new table and columns answer the publishable key with permission denied (present), and the first Web Push run on main finished `ok` with 0 pending (the queue query works on all three tables).
- **Capitulation alert** (3.10, ADR 0011 addendum): when the watch turns on, one high-priority regime alert in the brief's example-3 form, with Marsad's own event study and n; found while testing that the newest day is usually unavailable until FRED's morning VIX, so the job judges the newest complete day.

### Catalyst watch on end-of-day data (2026-11-25)

- **ADR 0030** (`catalyst-1`): Khaled writes scenarios on the Alerts page; each evening the catalyst-watch job matches them against the day's 8-Ks, Form 4s, tiered news, halts and moves. Tier 1 or two independent tier-2 sources confirm; the chase guard is applied in the plan ("no entry" beyond it); analog counts show in the bear case. Matches are recorded as shadow alerts until live data exists.

### Chart markers and versioned prompts (2026-11-25)

- Company chart: insider open-market purchases (placed on the session the Form 4 became public, never the trade date), trading halts and Marsad's alerts now appear as markers (2.1 done).
- Prompt registry (2.11, ADR 0007): four versioned prompts with evaluation cases graded offline by the same verifier as production; a wrong figure, an uncited sentence, a reversed direction and an instruction planted in a document are all rejected. Ready for the day an Anthropic key exists.
- Phase 3 items proven by today's live runs are closed (3.1, 3.2, 3.5, 3.11, 3.12); 3.3 waits for an outside spot check of past episodes.

### Phase 7 batch D: trade journal and adherence (2026-11-25)

- **ADR 0024** (`journal-1`): trades placed in Sahm, linked to alerts, with tags, notes and private screenshots; the Jimmy D adherence score by principle with every broken item named; statistics by setup and whether high adherence paid (with 30-trade flags).
- **Verified**: hand-checked adherence, R and statistics; RLS tests for trades and the Storage policy (owner folder, MFA, others refused); browser test for logging, exits, upload and display. Browser suite now 100 runs (desktop and iPad), each with a WCAG scan; the scan waits for the layout to settle (one intermittent result fixed).

### Phase 7 batch C: the scorecard (2026-11-25)

- **ADR 0023** (`scorecard-1`): every directional alert's outcome after 1, 5 and 20 sessions against SPY, with excursions and the first plan level touched, stored in `alert_outcomes` by the nightly `scorecard` job; the Alerts page summarizes them per rule, live against shadow, with Wilson intervals from 30 cases and quality-score calibration.
- **Verified**: the Phase 7 done-criterion test recomputes every summary figure from raw outcomes; hand-checked outcomes; mutation-checked; job, RLS and browser tests.

### Phase 8: security review, accessibility and performance passes, README (2026-11-25)

- **Security** ([SECURITY_REVIEW.md](SECURITY_REVIEW.md)): seven schema guards now fail any migration that opens a table, skips MFA, lets signed-in users write system tables, or adds a view or `SECURITY DEFINER` function to `public`; each guard mutation-checked. Live: sign-ups disabled, email only; strict CSP; COOP and CORP headers added; Actions pinned to commit SHAs with monthly Dependabot. Open: the Supabase Security Advisor (connector lacks permission; Khaled reads it).
- **Accessibility**: every browser test runs on desktop and an iPad-sized touch screen and ends with a WCAG 2.2 AA axe scan (96 runs pass). Fixed two real findings: small ticker links on Watch, and the chart container role that hid the attribution link.
- **Performance**: pages other than Watch load on first visit; the first download fell from 524 KB to 265 KB (before compression).
- **README** rewritten in Google style. PR #37 (Phase 7 batch B) merged; the new holdings columns are confirmed live.

### Phase 7 batch B: exit alerts, exposure and stress, rotation (2026-11-25)

- **ADR 0022**: exit rules fire alerts through the pipeline after each bars run (job `alerts-exits`, once per newly broken rule); exposure by sector, beta to SPY, concentration, correlations and stress scenarios (SPY -5/-10/-20%, VIX +10, sector -10%) labeled as approximations; the rotation signal from 3/6/12-month relative strength, trend and the thesis status Khaled sets. The bars job adds the 11 sector ETFs and open holdings.
- **Verified**: numpy known answers (betas, VIX sensitivity, correlations, relative strength) within 1e-10; hand-checked scenarios; job tests (one alert per newly broken rule, stale bars named and the run failed); RLS test for the new columns; browser test with an exact beta of 2.
- ETF overlap needs ETF constituent data no current plan includes: labeled on the page, noted in IDEAS.

### Phase 6 math ahead of options data (2026-11-25)

- **ADR 0021** (`options-1`): Black-Scholes-Merton prices and greeks, implied volatility, expected move, IV rank and percentile, defined-risk payoffs with breakevens, and the liquidity guard; checked against scipy within 1e-9 and by hand; mutation-checked. The data half of Phase 6 waits for the options plan decision.

### Phase 7 batch A: holdings, position sizer, Sahm ticket and exit conditions (2026-11-25)

- Phase 6 (options) needs the Options Developer plan (USD 79 a month) for data: not bought. Phase 7 needs no paid data, so it went first.
- **ADR 0020** (`portfolio-1`): the sizer and the Sahm ticket (copy only after the five-item checklist), personal holdings by hand or CSV, and exit conditions per holding checked on the newest bar. The Journal page replaces its placeholder; no placeholder pages remain.
- **Live**: the backtest lab ran once by hand (index trend filter 7 trades, 0 out of sample; ETF momentum 0; trend template 13, 1 out of sample): all drafts, insufficient history, as expected on two years of bars.

### Phase 5 batch A: alert pipeline, card, halt alerts and feedback (2026-11-25)

- Phase 5's prerequisites (Massive Stocks plan, Supabase Pro) cost money and are Khaled's decision; I did not buy either. Built what needs neither.
- **ADR 0019** (`alerts-1`): the pipeline (every gate's outcome stored as a reason), the card in the brief's order, push text limits, halt alerts for watched tickers (news halts critical), the `alerts` and personal `alert_feedback` tables, and the Alerts page with one-tap feedback.
- **Found while testing**: a halt alert's freshness must be the feed's age, not the halt's (a halt seen by a 5-minute job would always look stale); and a later run must never store the same event again, whatever it decides then.

### Phase 4 batch C: playbooks, lifecycle, runner, replay and the Lab page (2026-11-25)

- **ADR 0018**: the eleven playbooks (three testable on daily bars today), lifecycle gates, immutable rule versions (database trigger), rule events, stored backtest runs, a weekly runner, replay, and the Lab page (header link).
- **Verified**: playbook and gate tests; RLS test that a version's content cannot change but its status can; runner tests (versions only on changed content, live rules untouched, short histories skipped); replay equals the evaluator; browser test for intervals versus "insufficient history".
- With two years of bars most playbooks will show "insufficient history" and stay drafts; that is the honest outcome.

### Phase 4 batch B: backtester (2026-11-25)

- **ADR 0017** (`backtest-1`): next-open entries, intrabar stops, costs per side, reports with bootstrap intervals, benchmark, regime breakdown and Monte Carlo drawdowns; anchored walk-forward with trial counting and an untouched holdout.
- **Verified**: hand-checked trades; an independent Python backtester on seeded bars matches exactly; look-ahead and determinism tests; 10 mutations, two survivors (re-entry on the exit bar, open trades in the report) got tests and are now caught.

### Phase 4 batch A: statistics and the rule language (2026-11-25)

- **ADR 0016**: `stats-1` (normal distribution, Wilson, seeded bootstrap, Sharpe, deflated Sharpe, drawdown, trade statistics) checked against scipy, statsmodels and numpy; `rule-dsl-1` (JSON rules, validator, content hash, completed-bar evaluator) with a look-ahead property test.
- Mutation checks: 11 mutations; one survived (a cross starting from exactly on the line), a test was added and it is now caught.

### Phase 3 batch G: pre-market brief and close recap (2026-11-25)

- **ADR 0015** (`brief-1`): template briefs from stored data (no AI yet), stored with their input snapshot and delivery log, shown on the Watch page; email through Resend once Khaled adds two secrets (SETUP step 9). Web Push comes with the Phase 5 dispatcher.
- Workflows: `brief-pre-market.yml` (12:30 and 13:30 UTC weekdays, the job keeps only the run 30 to 89 minutes before the open) and `brief-close-recap.yml` (22:50 UTC weekdays).
- **Verified**: hand-checked template text (rounding, missing inputs, capitulation flag, no em dash); job tests for the window, holidays, the next session past Thanksgiving, sending once, and a failed send; RLS check constraints (kind, 140-character push body, one per kind and day).

### Phase 3 batch F: Watch dashboard (2026-11-25)

- **ADR 0014** (`watch-1`): the Watch page now has the market strip, the watchlist table, the sector heatmap, Marsad-universe movers, a gap scanner and watchlist news, beside the calendars. End of day only, stated on the page.
- The breadth job also writes `market_movers_daily` for the last 5 sessions (sector SPDRs and the top 10 gainers and losers among the month's members, bad prints left out).
- **Security fix**: news links (Study and Watch) are rendered only for https URLs; a vendor `javascript:` URL shows as plain text (tested).
- **Verified**: hand-checked summaries and movers; breadth job test asserts movers come only from the month's members; browser test with hand-worked percentages, gap and volume ratio.

### Phase 3 batch E: economic and earnings calendars (2026-11-25)

- **ADR 0013** (`calendar-1`): FRED release dates for ten tracked US releases with usual times and impact, FOMC statements from the Fed's calendar, and watchlist earnings estimated from each company's own results filings (labelled estimated). Append-only snapshots; the Watch page now exists with the calendar and earnings sections.
- **Fixtures**: recorded live through the Record fixtures workflow (new FRED-only recorder outside the Massive queue): 1,040 release dates over 10 weeks, and FRED's full release list, against which every tracked id and name was checked. FOMC dates read from federalreserve.gov.
- **Mistake caught**: I first wrote the new module over `packages/core/src/calendar.ts`, the existing market-hours calendar; `git status` showed it and I restored it from git before anything was committed. New code is in `econ-calendar.ts`; I now check a path is free before creating a file.
- Massive's earnings calendars (Benzinga, Wall Street Horizon) are not on the plan, so earnings dates are estimates.

### Phase 3 batch D: geopolitical panel (2026-11-25)

- Khaled boarded a flight and asked me to keep building, merging and deploying everything that needs no approval. I do not buy plans, add secrets, delete data or force-push.
- **ADR 0012** (`topics-1`): keyword rules for six topics on market-wide Massive news, daily counts in `news_topic_days`, the last 7 days against the 4 weeks before. Beside them: oil, the dollar, the 10-year yield (FRED), GLD, ITA, IYT (bars). GPR and EPU percentiles also appear under the regime label (3.6 done).
- **Verified**: 23 real articles hand-labelled (my first tally of the day count was wrong by one tariff and one energy article; the per-article labels were right); hand-written cases for figurative wars, sanctions, elections and central banks; job tests for paging without the key, resume and failure; browser test with hand-worked ratios; headline links rendered only for https URLs.

### Phase 3 batch C: Fear and Greed composite and capitulation watch (2026-11-25)

- **ADR 0011** defines `fear-greed-1` (seven components after CNN's method, percentile over 504 sessions, at least 4 of 7) and `capitulation-1` (VIX at least 30, at most 15% above the 50-day average, composite at most 15, recession filter not high; staged plan in thirds with pause, review, expiry, exit conditions and the bear case).
- **Data**: put/call has no source on the current plans, so the reading is at most 6 of 7 (5 of 7 until stock price strength has a year of its own history, around December 2026). IEF is added to the bars job (one call a day) for the safe-haven component.
- **Verified**: the composite matches an independent Python implementation on the real FRED downloads plus a seeded synthetic market for all 3,239 days to 1e-8; 17 rule mutations all caught (three needed new tests, added); hand-checked staged-plan scenarios (my first hand arithmetic was wrong in three places, the code was right); the capitulation proxy's 10 episodes checked against an independent scan (the 13 VIX-at-30 episodes minus the three in the 2020 to 2021 Sahm-rule period); RLS 22 passed; Node and Deno identical.
- **Jobs**: `sentiment-daily` runs after the FRED workflow (23:30 UTC) and after the breadth workflow (10:40 UTC), reads only stored data, and fails loudly when the newest composite is more than 5 days old.
- **Not yet**: the "Capitulation watch ON" alert needs the delivery channel (3.13); the quality-at-discount screen is a later phase.
- **Breadth backfill fix**: the first live backfill (run 45584836642) stored 3 sessions, then stopped on 2024-11-28 (Thanksgiving): Massive answers a holiday with zero records and no `results` field, which the shared client read as a bad response (the tests had assumed an empty `results` array). The grouped-daily adapter now treats exactly that shape (status OK, count 0, no `results`) as a closed market; anything else is still an error, and errors now name the response's fields (never values) and the technical message in the job log.

### Sign-in fix (2026-11-25)

- **Problem** (reported by Khaled from an iPhone): the sign-in email has a link and no code, and the link only worked in the browser that requested it (PKCE). Mail apps on iPhone open links elsewhere, so sign-in failed; the screen also asked for a code the email never contains.
- **Fix** (ADR 0005 revision 2026-11-25): implicit flow, so the link signs in wherever it opens; the field now accepts the copied link (or a code) and verifies its one-time token in any browser, including the Home Screen app; a failed link's reason is shown; the address bar is cleaned. TOTP (aal2) is still required for all data.
- **Verified**: 15 unit tests for the link and error parsing; browser tests for the request (no code challenge, no user creation), a link opened in a fresh browser, a pasted link, a pasted non-link, and a failed link; restoring PKCE makes two of them fail. Not verified against the live Supabase project from here (no access to its auth logs or the inbox): Khaled's first sign-in is the live check.

### Phase 3 batch B: Marsad universe and breadth (2026-11-25)

- **ADR 0010** defines the universe (top 1,000 US common stocks and ETFs by 20-session dollar volume, rebuilt monthly from data before the rebuild, point-in-time ticker lists so delisted names count) and breadth (above the 50- and 200-day averages, 52-week highs and lows, advancers and decliners with volume, the Zweig thrust, a McClellan-style volume oscillator).
- **Data**: confirmed with the project key that the free plan's grouped daily returns the whole market (12,650 tickers) in one call. Each session is stored unadjusted and compressed; splits from the stored all-market split history are applied when reading, so a split never looks like a crash and stored data never changes.
- **Verified**: core matches an independent Python implementation on a seeded synthetic market with a halt, a bad print, a late listing, a flat line and a Zweig thrust (all universes and all 308 days); every rule mutation-checked; Node and Deno identical; adapters tested on real recorded responses; job tests for resume after a failure, the per-run cap, a 3-for-1 split, a holiday, eligibility and the USD 1 million floor.
- **Found while building**: the test HTTP helper's clock never advanced, so a test making more than 100 calls spun forever (fixed: a wait now moves its virtual clock); and the job reported a confusing "no ticker lists" error after a failed fetch instead of the real failure (fixed).
- **After merge**: run "Massive universe breadth" by hand once. The first run fills 2 years (about 520 sessions and the ticker lists, about 2 hours); other Massive jobs wait meanwhile. The page shows breadth after that.

### Live: regime (2026-11-25, PR #23 merged as `54e9c4a`)

- The Supabase integration created `regime_daily` and `regime_event_stats` (anon REST returns 401; it took longer than the usual 30 seconds, about 2 minutes).
- FRED daily, run by hand on `main`: `fred-daily: ok, rows 80484` (14 series, now with VIX3M and the S&P 500), then `regime-daily: ok, rows 2512`: latest 2026-11-23, label stress, recession filter elevated, sessions 2016-11-25 to 2026-11-23. The same values the tests compute from the recorded files.
- CI on `main` failed after the merge: the regime job test timed out at 5.6 seconds on the runner (4.3 locally). Cause: the recession filter rescanned every series for each day (the production regime step took 19 seconds). Fixed in PR #24 with a binary search; results unchanged and pinned by the tests.

### Phase 3 batch A: regime label, recession filter, volatility, credit and uncertainty panels (2026-11-25)

Built on Claude Opus 5.5 at high effort, as the brief asks for the methodology. ADR 0009 documents every rule and threshold and what the free data allows.

- **What the free data reaches** (measured): VIX3M is free on FRED, so the term structure needs no paid plan; the S&P 500 on FRED keeps 10 years and the ICE BofA spreads 3 years; Massive's grouped daily returns the whole market in one call on the free plan (for the breadth batch).
- **Core** `packages/core/src/regime.ts`: the recession filter (5 signals, point-in-time publication lags), the regime label (first rule that matches), event studies (non-overlapping episodes, NumPy-style quartiles, an all-days benchmark, "insufficient history" below 30 episodes), and panel helpers. Checked day by day against an independent Python implementation on real FRED history and against known facts (the Sahm rule's July 2024 trigger, the October 2022 curve inversion). Every rule mutation-checked; Node and Deno identical.
- **A rule I changed after looking at the output:** the first recovery rule labelled 30% of all days, including months at new highs after a brief VIX spike. It now also requires the S&P 500 to be at least 5% below its high (ADR 0009 records this).
- **Job and tables:** FRED job now also stores VIX3M and the S&P 500; `regime_daily` stores every day with its inputs and rule versions (the stored inputs reproduce the stored label, tested); `regime_event_stats`; the regime step runs after the FRED job and fails loudly when the S&P 500 is more than 5 days old.
- **Regime page:** label, reason, inputs and how long it has held; recession filter with each signal; event-study table; volatility, credit and curve, GPR and EPU panels, each with source and the date of every value.
- **Honest limits:** with 10 years of free S&P 500 data, every label has fewer than 30 independent episodes, so the event study shows "insufficient history" (the all-days benchmark has enough at 1 and 3 months). The label also changes about 32 times a year (IDEAS.md).
- **After merge:** the migration creates `regime_daily` and `regime_event_stats`; run the FRED workflow by hand once (it fetches VIX3M and the S&P 500 and then computes the regime).

### Phase 2 report (2026-11-24): Study module, built without the AI pieces

- **Live** at https://marsad-k84.netlify.app, Study, any starting stock: candlestick chart with SMA, EMA, RSI, volume and markers (8-Ks including earnings, splits, dividends); filings timeline with 8-K labels; financials as filed with a "known as of" date picker; earnings history with the move after each release; insider Forms 3, 4 and 5; short interest and short volume; clustered news with source tiers; dividends; a year-over-year risk-factor comparison of the two newest 10-Ks. ETFs show the chart, short data and news.
- **Verified:** `./init.sh` exit 0 with 473 tests; `pnpm e2e` 23 pass; Node and Deno give byte-identical results; every number-producing part was checked against an independent Python reading of the same real data; every new rule was mutation-checked.
- **Tap to test:** Study, NVDA. Move the "Known as of" date on Financials back to 2026-08-25 (the newest quarter should disappear). Open "Risk factors, year over year" and tap "Show the comparison". Look at Insider filings for the Filed date beside each trade date.
- **Needs you:** (1) add `ANTHROPIC_API_KEY` yourself as a GitHub Actions secret and approve the caps in ADR 0007 (USD 1 a day, USD 10 a month, warning at 80%): this unblocks the summaries, the thesis card and the prompts (checklist 2.9 to 2.11); (2) the scheduling decision in ADR 0008: GitHub's scheduler has barely fired, so the 5-minute and 30-minute feeds go stale in market hours until it is fixed; (3) public or private repo.
- **Honest gaps:** the AI items 2.9 to 2.11 are not built (the verifier and fallback are built and tested offline); 13F holders and 10-Q sections are labelled "Not built" with the reason; chart markers for insider buys and halts are not done; estimates, surprise, guidance, analyst actions and the 5-year valuation history show "Requires a higher Massive plan" as the brief allows; the 0.6 cut-off for an "edited" risk sentence is a default checked on one company pair.
- **Next phase:** Phase 3 (market overview and regime): Claude Opus 5.5 at high effort for the methodology and event studies, Claude Sonnet 5.5 at high effort for the screens. If you want the AI pieces first, finish item 1 above and I will do those before Phase 3.

### What is NOT done (carried forward, none blocks Phase 2)

- 5.2b (new): Supabase platform bundling of a real Edge Function is unverified (needs an access token and a first function).
- VIX versus FRED needs the Massive Indices plan; filings completeness needs a second filings feed (IDEAS.md).
- The VWAP check covers SPY only, over five sessions of evidence; the 0.1% margin (max seen 0.074%) is thin (IDEAS.md).
- Nasdaq Trader terms of use not independently reviewed (Khaled approved polling).
- The Phase 0 follow-ups (advisors, `list_migrations`, Auth Hooks empty) need a session whose Supabase connector sees the project; the connector still lists only the work organization.
- Decision for Khaled: scheduling (ADR 0008, item 1.15) and the repository is public (GitHub `private: false`) while the docs say private.

### Done (Phase 0)

- Docs: SETUP.md, ARCHITECTURE.md, DATA_SOURCES.md, IDEAS.md, ADRs 0001 to 0005, CLAUDE.md, BUILD_PROMPT.md (the brief, saved verbatim).
- pnpm monorepo: `apps/web`, `packages/core`, `supabase`, `jobs`, `fixtures`.
- `packages/core`: time helpers (ET and local clock through the IANA database) with DST tests.
- Database baseline migration: personal tables (`user_settings`, `watchlists`, `watchlist_items`) and system tables (`job_runs`, `source_status`), RLS on all, every policy requires an MFA (aal2) session, anon has no grants.
- RLS tests on PGlite (14 tests): another user cannot read, change, delete or insert the owner's rows; aal1 and anon read nothing; non-owners read no system rows; schema guards. A deliberate policy mutation made 5 tests fail, so the suite is not vacuous.
- Web app: email code sign-in (`shouldCreateUser: false`), TOTP enrollment and challenge, aal2 gate, shell with bottom tab bar and ET/local clock, status page skeleton, PWA manifest and icons, strict CSP and noindex headers.
- Playwright: 5 smoke tests (signed-out screen, no user creation, error text, aal1 sent to MFA, aal2 sees shell and status page).
- CI workflow (typecheck, lint, format, tests, build, Playwright): green on GitHub, run 45225834635.

### Blocked on Khaled (see docs/SETUP.md)

1. Done by Khaled: Supabase org **Personal Projects** (Free) and project `hwdwivilqdydmxhycapy` (Tokyo), linked to this repository.
2. Done by Khaled: Supabase connector reconnected with **Personal Projects**. Connectors load at session start, so the session that started Phase 0 still could not see the project (`get_project` returned a permission error). Verify access first thing in the next session with `list_projects`.
3. Done by Khaled: GitHub integration settings checked (working directory `.`, branch `main`, Deploy to production on).
4. Step 2: Auth settings (sign-ups off, TOTP on, code email template) and the owner user.
5. Done: Khaled confirmed Netlify team "GIG" (`khaled-alghamdi-84`) is personal. Claude created site `marsad-k84` (id `c8eb3a9d-8c02-4bba-818e-1970923ca7ea`, `https://marsad-k84.netlify.app`) and set `VITE_SUPABASE_URL`. Note: the same team also hosts Gulf Insulation sites (giginsulation.app); Khaled decided it is personal.
6. Done: Khaled linked the Netlify site to GitHub `main` (build `pnpm --filter @marsad/web build`, publish `apps/web/dist`). The first deploy of `main@f70e132` (README only) failed as expected.
7. Next session: read the publishable key with the Supabase connector (`get_publishable_keys`) and set `VITE_SUPABASE_PUBLISHABLE_KEY` on the Netlify site.

### Merged and deployed (2026-11-23)

- PR #1 merged into `main` as `c75df75` at Khaled's request.
- Netlify production deploy of `main` is live at `https://marsad-k84.netlify.app` (HTTP 200, CSP and `X-Robots-Tag: noindex` present). It shows "Configuration missing" until `VITE_SUPABASE_PUBLISHABLE_KEY` is set.
- The Supabase GitHub integration should have applied `20261123000000_baseline.sql` on the merge. Not yet verified: this session's connector cannot see the project.
- Khaled reported Supabase Auth set up ("Supabase signed in"), but has not yet confirmed each of the five settings (sign-ups off, TOTP on, token email template, owner user confirmed, Site URL). Re-check them in the next session.

### Live checks with the publishable key (2026-11-23, after the merge)

- Khaled shared the publishable key; Claude validated it against `/auth/v1/settings` (HTTP 200; a variant with a capital I instead of lowercase l returns 401) and set `VITE_SUPABASE_PUBLISHABLE_KEY` on Netlify. It takes effect on the next deploy.
- `/auth/v1/settings` reports `disable_signup: false`: **sign-ups are still on** in the live project. Khaled must turn them off (SETUP step 2.1).
- REST requests for `job_runs`, `source_status`, `user_settings` and `watchlists` return 404 "Could not find the table": **the GitHub integration did not apply the baseline migration** on the merge of PR #1.
- Likely cause (unconfirmed): no `supabase/config.toml`, which the Supabase CLI uses to recognise the project directory. Added one, generated with `supabase init` (CLI 3.3.0) and set to Marsad's values. Khaled should also check the integration's deploy log.
- How to verify without the connector: anon REST on `job_runs` returns 404 while the table is missing and 401 or 403 (permission denied) once the migration has run, because anon has no grants.

### Auth findings while Khaled configured Supabase (2026-11-23)

- Sign-ups now off: live `/auth/v1/settings` reports `disable_signup: true`. Confirm email on. TOTP shows Enabled in the dashboard (not verifiable from outside; the sign-in test proves it).
- Email templates cannot be edited on Free without custom SMTP; the default email has a link, not a code. The web app now accepts the link through PKCE (ADR 0005 revision), with a new e2e test of the full link exchange.
- Khaled nearly created an Auth "Send Email hook" pointing at the Netlify site, which would have stopped all auth emails; he was told to cancel it. Next session: confirm Auth Hooks lists nothing enabled.
- No user existed yet (dashboard Users list empty); Khaled is creating it.

### Root causes found 2026-11-23 (after PR #2 merged)

- Migration not applied: the Supabase GitHub integration had **Deploy to production switched off** (Khaled's screenshot of Project Settings, Integrations). Working directory `.` and repository were correct. Khaled is turning it on with production branch `main`. The next push to `main` should apply `20261123000000_baseline.sql`; verify with anon REST on `job_runs` (404 means missing, 401 or 403 means present).
- "Configuration missing" on Khaled's iPad while the live site served the sign-in screen: the PWA service worker used `registerType: 'prompt'` with no prompt UI, so a waiting worker kept serving the first (keyless) build. Switched to `autoUpdate` with `skipWaiting`, `clientsClaim` and `cleanupOutdatedCaches`.

### Sign-in verified (2026-11-23 18:33 UTC)

- Khaled signed in at `https://marsad-k84.netlify.app` on his iPad with the emailed link and TOTP enrollment, and reached the Watch tab (screenshot: clock 13:33 ET, 21:33 local). The shell renders only at aal2, so this proves email sign-in plus MFA end to end. Phase 0 done criterion 1 is met.
- Supabase "Deploy to production" is now on (branch `main`), confirmed by Khaled's screenshot.

### Migration applied and owner added (2026-11-23 18:36 UTC)

- With Deploy to production on, merging PR #3 (`c83df4b`) applied `20261123000000_baseline.sql` within about 30 seconds.
- Live check with the publishable key (anon role): `job_runs`, `source_status`, `user_settings`, `watchlists` and `watchlist_items` all return 401 `permission denied` (42501). The tables exist and anon has no access, as designed.
- Khaled added his user (`eb05aa71-5d03-498f-a557-3d9fe8c23330`) to `private.app_owners` in the SQL Editor (insert guarded by "exactly one user exists"; returned 1 row).

### Phase 0 follow-ups for the next session (do these first)

1. With the Supabase connector (connectors load at session start): confirm `list_projects` shows `hwdwivilqdydmxhycapy`; run `get_advisors` (security and performance) and fix anything open; `list_migrations` should show `20261123000000`; confirm Auth Hooks has nothing enabled.
2. Done 2026-11-24: Status page screenshot received (see Verified live).

### Earlier plan (kept for history)

1. Khaled merges PR #1; the GitHub integration applies the baseline migration. Never also apply it through the connector (ADR 0004).
2. Verify through the connector: tables, RLS, policies, migration history, advisors. With Khaled's approval, add his user id to `private.app_owners`.
3. Set `VITE_SUPABASE_PUBLISHABLE_KEY`, trigger a deploy, confirm headers on `https://marsad-k84.netlify.app` (CSP `connect-src` is pinned to `hwdwivilqdydmxhycapy.supabase.co`).
4. Khaled signs in with email code and TOTP; mark Phase 0 done.

### Notes for the next session

- Deploy preview `https://deploy-preview-1--marsad-k84.netlify.app` (2026-11-23): built on Netlify; live headers verified (CSP pinned to the project host, `X-Robots-Tag: noindex`, Referrer-Policy, Permissions-Policy, HSTS, X-Frame-Options); SPA deep link `/status` returns 200; `robots.txt` disallows all. Page showed "Configuration missing" as expected (no publishable key yet).
- On deploy previews the browser logs two CSP violations from Netlify's injected review drawer (an inline style and a frame of app.netlify.com). The same build served locally under the same CSP logs none, so they are Netlify's, not Marsad's. Production deploys do not inject the drawer. Optional: turn the drawer off in Netlify (Deploy settings, Deploy Previews, Netlify Drawer).

- TypeScript is pinned to 6.0.x because typescript-eslint does not support 7.x yet (ADR 0001).
- PGlite has one connection: never call `db.query` from inside a `db.transaction` in tests (it deadlocks).
- Playwright uses the preinstalled Chromium at `/opt/pw-browsers/chromium` in cloud sessions; CI installs its own.

## Design handoff match (claude/marsad-design-match)

Matched to the handoff screenshots and checked by Playwright (desktop 1440, phone 390) plus the axe scan:

- Foundation: ink, crit, line-soft and ema tokens, IBM Plex Sans Arabic and Mono as files (CSP font-src 'self'), wide breakpoint.
- Sign in: password, create account, link, code, Unavailable banner.
- Lab: title, lifecycle filter strip, 3-up cards, gate ticks, details toggle, Not recommended grid.
- Status: hero with source bars, source cards, job-run strips, system alerts, costs, three-step notifications, preferences panels. Alert latency and Weekly exports (not in the design) are kept below, not removed.

Still to match, in order: Shell market sheet copy, Regime, Alerts, Journal, Watch, Study, member states.

Known data limits: no 90% bootstrap bars in the Regime event study, no Lab equity curves, no GitHub Actions minutes bar.

### Design match update

Matched since the last note: Alerts (header tabs, list cards, numbered detail sections, feedback prompt), Watch (width, link size), Journal positions (holdings card grid). Still to match: Alerts scorecard table and scenario card grid, Journal ticket, CSV button and other tabs, Study, Regime detail, member states, 390 px comparisons.

### Design match, second pass

Merged in #68. This pass: Regime hero shows the four design tiles. Known limits: the Regime event study has no 90% interval bars because the stored statistics do not hold them (needs a job and migration change), watchlist and Study cards have no company names, and the Shariah tab lacks the filing reference. Still to compare: Journal ticket and tabs, and 390 px views for every page.

### Whole-market movers (movers-1, ADR 0049)

- Core `moversSession` (`packages/core/src/movers.ts`, 12 known-answer tests): gainers, losers, most active, unusual volume (3x the 20-session average and USD 5 million, 50-session ratio shown), new 52-week highs and lows by close (252 sessions), liquidity floor (USD 1 close, USD 2 million traded), bad prints and the 25% and split corporate-action checks.
- The breadth job stores it per session in the new owner-only `market_movers_market` (migration `20270105120000`); `market_snapshots` and `ticker_type_snapshots` go back to owner-only (ADR 0048).
- Watch: Movers is now a self-contained view (`components/watch/Movers.tsx`, `lib/movers.ts`) with Whole market and Marsad universe, six lists, a minimum dollar-volume filter, "On my list", and the latest stored headline per row. Ready to move to Markets.
- Shows after the next breadth job run once the migration is applied.
