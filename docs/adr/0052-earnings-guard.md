# ADR 0052: Earnings guard (`earnings-guard-1`)

- Status: accepted (the job side of batch 5 of ADR 0048)
- Date: 2026-11-28

## Context

ADR 0048 asks for "an alert 5 sessions before for holdings": a results release can gap a holding through its stop, and the date is known in advance. Two stored sources give the date. Tauric's calendar (`company_research.calendar.earnings.earnings_date`, ADR 0047) states it. Marsad's `calendar-1` estimate (ADR 0013, from past 8-K item 2.02 dates, with a window of 7 days either side) covers what Tauric does not. The nightly summary (ADR 0050) already picks between them: Tauric's date when it is after the session, else the estimate.

The exit alerts (ADR 0022) are the closest pattern. They are factual checks of Khaled's own written rules, registered in code as rule `exit-<kind>` version 1, status `live`, without a backtest. Their alert input is their snapshot, and the job runs as a step of the data workflow that feeds it.

## Decision

1. **Core `packages/core/src/earnings-guard.ts`** (pure).
   - `earningsGuardScan` takes the open holdings, each ticker's stored dates, each ticker's close and the trading calendar. It returns one snapshot per holding whose next results date is at most 5 trading sessions after the last completed session.
   - Sessions are counted by `tradingSessionsBetween` (new in `calendar.ts`): weekdays after the session, up to and including the date, that the vendor holiday table does not mark closed. Early closes count.
   - The date comes from `nextResultsDate`, now shared with the summary row, so the two never disagree. An estimate is labelled "Marsad estimate ..., estimated from past results filings, window ...", and the headline says "(estimated date)".
   - Each snapshot carries the ticker, the date and its source, shares held, the stop, the close of the session, and whether exit rules are set (`hasExitRules`, now exported from `portfolio.ts` and shared with the Portfolio review).
   - Distance to the stop is `(close - stop) / close`: how far below the close the stop sits, as a share of the close. The Portfolio review shows `gapToStop` (`close / stop - 1`, a share of the stop), so the two percentages differ slightly. With a close of 174.10 and a stop of 160.00, the alert says 8.1% and the review 8.8%. Each is labelled with what it measures.
2. **Text is facts only**, for example: "NVDA reports in 4 sessions (Tauric date 2026-12-03). You hold 13 shares; stop 160.00, 8.1% below the close; exit rules set." It never says consider, sell, trim or hold. A test checks the wording.
   - Missing parts are stated: "no stop set", "distance unavailable (no close stored for <session>)" and "no exit rules set".
   - When the holiday table ends before the date, the text says the count assumes no other holidays.
   - The bear case is a fact, not advice: a release can gap through the stop, and a stop order fills at the next traded price.
3. **One alert per holding per results date.**
   - The event id is `earnings:<holding id>:<date>`, so the pipeline key is `earnings|<ticker>|earnings-guard|earnings:<id>:<date>`.
   - The job reads the rule's alerts of the last 30 days (`getRuleAlerts`), so a repeat inside the window is counted as deduped, not stored. The pipeline itself only remembers 24 hours.
   - A changed date gets a new event id. Its alert names the earlier alert's time (UTC and ET) and date, and stores the earlier alert's id in the snapshot.
4. **Kind `earnings`** (migration `20270107000000`, additive: it widens the `alerts.kind` check like `20261216000000` did for briefs; RLS unchanged, owner-only read, tested). It is a new kind because the existing ones are wrong for a calendar notice. `exit` and `catalyst` are directional in the scorecard (`directionOf`), and `exit` reads "Exit rule" on the card. `earnings` is non-directional, so it is not scored. It is enabled by default (`DEFAULT_ALERT_SETTINGS.enabledKinds`). Priority is normal: quiet hours and the daily push cap from `alert_preferences` apply through `pipelineAndStore`.
5. **Rule registration and lifecycle.** Rule `earnings-guard`, version 1, status `live`, set in code, as the exit and halt rules are. This follows ADR 0022: the rule makes no directional call and has no expectancy to backtest, so the draft, backtested and shadow gates (ADR 0018) do not apply. A change to the window, the source order or the text is a new formula version (`earnings-guard-2`) and a new rule version, never an edit of version 1.
6. **Snapshot and replay** (integrity rule 12). `AlertInput` gains an optional `snapshot` field. The guard stores its `earnings-guard-1` snapshot there: the job time, session, holding fields, date, source, as-of and window, the closed days in the count, the holiday table's last date, the close with its fetch time, and the earlier alert. `earningsGuardAlert` builds the input from the snapshot alone. `replayEarningsGuard(stored)` recomputes it from the stored snapshot and context, and tests check it equals the stored input after a JSON round trip.
7. **Freshness.**
   - A date source older than 7 days (Tauric's earnings refresh time, else the calendar's; the estimate's computing time), or without an as-of time, is named in the run error. Nothing is stored for that holding, so the next run alerts once the source is fresh. A suppressed alert would block the date for good.
   - The close is used only when its bar is the last completed session.
   - The input says "delayed data" and allows 7 days in the pipeline's freshness gate, since the scan already enforces the limits.
8. **Job `earnings-guard`** (`jobs/src/earnings-guard-job.ts`, entry `earnings-guard-main.ts`, store `earnings-guard-store.ts`). It runs as a step of `.github/workflows/ticker-summary.yml` after the summary step (11:25 UTC Tuesday to Saturday, after the research job at 09:35), followed by the Web Push dispatcher, the same way exit alerts run inside the bars workflow. It needs no new cron line: the Supabase Cron entry `gh-ticker-summary` already starts that workflow. It runs even when the summary step fails, because it reads `company_research`, `earnings_estimate_snapshots`, `daily_bars` and `holdings` itself. Every run writes `job_runs` with the session, holdings checked, alerts stored, no date (count and tickers, reported, never alerted), deduped (count and tickers), dates beyond the window and the pipeline's decisions.

## Consequences

- Khaled gets at most one push per holding per results date, about a week ahead, and one more if the date moves.
- A holding with no date anywhere shows only in the run details; the Portfolio review already shows its next earnings as unavailable.
- The Alerts page shows the raw kind `earnings` until `strings.ts` gains a label (`alerts.kinds.earnings`). That file belongs to the pages agent (ADR 0051), so the label is left to that change.
- Watchlist rows are not alerted (ADR 0048 asks for holdings only); their days to earnings are a page change for batch 4.
