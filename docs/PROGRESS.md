# Progress

## Current phase: 3, Market overview and regime (in progress). Phase 2 built except the AI items (blocked on the API key).

Last updated 2026-11-25 (Phase 6 math ahead of options data; Khaled travelling, working autonomously on his instruction).

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
