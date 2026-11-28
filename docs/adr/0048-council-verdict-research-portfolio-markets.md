# ADR 0048: Council verdict on the TipRanks-style features: pages, rules and build plan

- Status: accepted (Khaled, 2026-11-28: "we will go with the final verdict as a plan")
- Date: 2026-11-28

## Context

Khaled sent about 50 TipRanks screens and asked for all of their features in Marsad. In scope were company research, Smart Portfolio, the dividend tools, market movers, the advanced chart and crowd insights. Four agents had started building them inside the existing pages (Study, Journal and Watch). Khaled then asked a council to decide how best to implement each feature and which new pages to add, and he adopts its verdict as the plan.

Six members reviewed the brief and the repository independently:

- swing trader
- long-term income investor
- information architect
- data integrity and cost auditor
- software architect
- risk coach (skeptic)

Every member ruled on every feature. Where they differed, this record gives the ruling and the reason.

Context the council weighed, from Khaled's own screens: unrealized loss about 53% of cost, beta about 2.6, about 88% of value in the top 5, 0% cash, and 4 of 16 trades profitable. The product rule stands: Marsad informs and never advises. Several members noted that much of TipRanks is built to keep users engaged and confident. Analyst upside and "health" scores in particular can make holding a losing position feel justified.

## Decision

### 1. Site map

| URL                                                                     | Page                                                                 | What it holds                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                                                     | Watch                                                                | Brief, cockpit, strip, watchlist, news, next 7 days of the calendar, and movers for Marsad's tickers. Each summary card ends with a link into Markets.                                                                                                                                                                                                         |
| `/markets?view=regime\|movers\|sectors\|calendar`                       | Markets (new; replaces `/regime`, which redirects to `?view=regime`) | Regime as today. Whole-market movers (`movers-1`). Sectors. Calendar: earnings, ex-dividend dates by day and macro. Opens on `regime`, never on movers.                                                                                                                                                                                                        |
| `/study/$ticker?view=`                                                  | Study                                                                | Ten views; details below. The chart stays above them. On phones, a chip row shows one view at a time instead of the accordion stack.                                                                                                                                                                                                                           |
| `/portfolio?view=review\|holdings\|analysis\|performance\|income\|news` | Portfolio (new; taken out of Journal)                                | Opens on **review**: per holding, the exit condition met or missing, distance to stop (% and ATRs), dollars at risk, size against cap, sessions held, next earnings, and "the sizer allows N shares; you hold M". Above them sit the total open risk as % of equity and Khaled's own limits against his actual figures. Holdings with no exit rule come first. |
| `/journal?view=trades\|sizer\|review`                                   | Journal                                                              | What Khaled did: trades, sizer and Sahm ticket, adherence, weekly review. Study headers and Portfolio rows have "Size a trade" links into the sizer.                                                                                                                                                                                                           |
| `/alerts`, `/lab`, `/status`, `/settings`                               | unchanged                                                            |                                                                                                                                                                                                                                                                                                                                                                |

The ten Study views are:

- **overview:** facts first (brief, business, key statistics with dilution, free cash flow margin and net cash, stock vs SPY, peers), then the bear case and Khaled's exit conditions, then the labelled opinion (Tauric AI thesis).
- **analysts:** consensus and its counts, the target range chart, the recommendation trend, and the single next-quarter estimate.
- **financials:** statements, the Piotroski score as "n of 9 tests passed" with each test shown, and the snapshot.
- **earnings:** history, past reactions from bars, estimate against reported, the next date.
- **technicals:** the n-of-m summary, levels, and the indicator table.
- **dividends:** history, coverage, cut flags and the calculator.
- **ownership:** 13F, insiders, short data and the ownership bar.
- **news:** news with the vendor's sentiment.
- **filings:** filings with the risk factors.
- **shariah.**

Navigation:

- **Desktop:** Watch, Markets, Study, Portfolio, Journal, Alerts, Lab, Status, with a Settings gear.
- **Phone bottom bar:** Watch, Study, Portfolio, Markets, Alerts, with More holding Journal, Lab, Status, Settings and Sign out.

Every view has a URL (`?view=`). The URL wins, and the stored choice is only the fallback, so alerts, briefs and friends can link to a view.

Not added: separate Dividends, Analyst, Compare and Screener pages. The data is too thin for them, and they would duplicate other pages. Compare and the screener go to IDEAS.md. The screener comes back after the summary table (section 4).

### 2. Feature rulings

| Feature                                                                  | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Analyst consensus and targets                                            | Keep, below the facts and the bear case. Show "mean target vs last close" with low, median and high, the analyst count and the refreshed date. Never a headline "upside %".                                                                                                                                                                                                                                                                      |
| Analyst column on holdings, and the "target above while below cost" card | Cut. Upside next to a red P/L is exactly the screen that makes holding a loser feel justified.                                                                                                                                                                                                                                                                                                                                                   |
| Recommendation trend                                                     | Keep, from `analyst_history`, saying that the history starts on 2026-11-28.                                                                                                                                                                                                                                                                                                                                                                      |
| Per-analyst ratings, best analysts, estimate ranges, surprises           | Not available: Massive's Benzinga add-on, USD 99 a month per dataset and not on the plan. Also excluded because a success rate drawn from fewer than 30 calls is opinion presented as fact.                                                                                                                                                                                                                                                      |
| Tauric AI analysis                                                       | Keep, labelled per ADR 0047, with the bear case first.                                                                                                                                                                                                                                                                                                                                                                                           |
| Technicals                                                               | One engine, one version: `technical-1` merges the two drafts. Show n of m code signals and the indicator table from `indicators.ts`. No gauge and no buy/sell words. Chart patterns deferred: there is no reference implementation to test against.                                                                                                                                                                                              |
| Support and resistance (`levels-1`)                                      | Keep, on the chart.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| News sentiment                                                           | Keep the vendor's words (positive, neutral, negative), not "bullish" or "bearish". Show "n articles from k publishers", and no share from fewer than 30 articles.                                                                                                                                                                                                                                                                                |
| Earnings call summary, FAQ, options chain                                | Cut: there are no transcripts, and the options chain is paid.                                                                                                                                                                                                                                                                                                                                                                                    |
| Portfolio health score, crowd insights                                   | Cut. One score hides its inputs, and there is no crowd data (friends' books are private).                                                                                                                                                                                                                                                                                                                                                        |
| Portfolio check (`portfolio-check-1`)                                    | Keep. Attention cards state facts, the rule and that position's exit condition, never "consider cutting". Any card that raises an alert is computed in a job with its input snapshot (rule 12).                                                                                                                                                                                                                                                  |
| Portfolio limits                                                         | New in Settings: largest position, top-5 share, minimum cash and maximum beta, each set by Khaled and shown against his actual figure with a count of breaches.                                                                                                                                                                                                                                                                                  |
| Holdings vs SPY                                                          | Keep, labelled "Current holdings at today's weights, not your actual result". A time-weighted result from trades comes later.                                                                                                                                                                                                                                                                                                                    |
| Performance                                                              | In R: expectancy, average win against average loss, sessions held by winners against losers, and results split by adherence. Counts, not percentages, below 30 trades.                                                                                                                                                                                                                                                                           |
| Portfolio P/E and beta                                                   | Keep. State the coverage (n of 9) and which beta is used.                                                                                                                                                                                                                                                                                                                                                                                        |
| Dividend calculator                                                      | Keep, on Study's dividends view. Withholding defaults to 30%, the US rate for a non-treaty resident (IRS Publication 515; Khaled to confirm), and is editable. The ticker's trailing price change is shown beside the price-growth input.                                                                                                                                                                                                        |
| Dividend comparison                                                      | Deferred to a later batch. When built, total return must include price change and splits.                                                                                                                                                                                                                                                                                                                                                        |
| Portfolio income                                                         | Keep: forward 12-month income, yield on cost, and income by holding, net of withholding.                                                                                                                                                                                                                                                                                                                                                         |
| Dividend calendar                                                        | Keep: Markets calendar, plus ex-dates of holdings in Watch's next 7 days. An ex-date gap can trip a stop.                                                                                                                                                                                                                                                                                                                                        |
| Movers (`movers-1`)                                                      | Keep, on Markets:<br>- labelled "Last completed session (end of day)";<br>- liquidity floor (minimum price and dollar volume);<br>- "On my list" filter;<br>- stated unusual-volume rule;<br>- corporate-action guard above 25%;<br>- catalyst shown as "Latest stored headline, not a verified cause";<br>- whole-market lists owner-only (`market_snapshots`, ADR 0010; Massive plans are for individual use);<br>- no push alerts for movers. |
| After-hours, intraday, live labels                                       | Cut: Marsad has no data for them.                                                                                                                                                                                                                                                                                                                                                                                                                |
| Earnings guard                                                           | New: days to the next earnings on holdings and watchlist rows, and an alert 5 sessions before for holdings.                                                                                                                                                                                                                                                                                                                                      |
| Recently viewed                                                          | Keep, in local storage on Study's index.                                                                                                                                                                                                                                                                                                                                                                                                         |

### 3. Paid decisions (council unanimous: spend nothing now)

| Item                                         | Cost                                                            | Unlocks                                | Ruling                                                                    |
| -------------------------------------------- | --------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------- |
| Massive Benzinga ratings, insights, earnings | USD 99 a month each (massive.com/partners/benzinga, 2026-11-28) | Per-analyst rows, estimates, surprises | No. It strengthens the opinion layer, not the discipline.                 |
| Massive options                              | USD 79 to 99 a month (not confirmed)                            | Chain, IV, put/call                    | No. That is 9 to 11% a year of the account, and it adds leverage tooling. |
| Real-time stocks                             | USD 199 a month                                                 | Intraday, after-hours                  | No. Decisions are made before the open or after the close.                |
| Anthropic key                                | Usage-based                                                     | AI explanations                        | Later, once the code-computed facts exist to be explained.                |

### 4. Engineering rules

- **Single engines.** One calculation engine per subject. New indicators live in `indicators.ts`, with known-answer tests.
- **Summary table.** A nightly `ticker_daily_summary` table, keyed by version, date and ticker, with typed columns, as-of, sources and formula versions. A job writes it with the same core functions, and a parity test checks that the job's output equals the browser's. It serves Watch, the quick look, Portfolio and the later screener in one read, replacing the per-page bar loops.
- **Strings.** `strings.ts` is split into per-area modules re-exported from `strings.ts`, so parallel agents stop colliding.
- **Shared shell.** One agent per wave owns `router.tsx`, `Shell.tsx` and `PriceChart.tsx`.
- **Loading.** Lazy chunks per Study view and a bundle budget in CI. Today `index` is 382 KB and `kit` is 250 KB.

## Build plan (merge in this order)

0. **In flight, into PR #83, one at a time:**
   - Research, after the engine merge and the regrouping into the ten Study views.
   - Portfolio, rebuilt as components with the review view first, ready to move.
   - Movers.
   - Full checks after each.
1. **Strings split, plus an ADR.**
2. **`ticker_daily_summary`:** migration with RLS, core, job and parity test. Runs in parallel with batch 3.
3. **Navigation:**
   - `/portfolio` and `/markets` (with the `/regime` redirect);
   - `?view=` on every page;
   - Shell tabs and the More sheet;
   - "Size a trade" links;
   - recently viewed;
   - a Playwright check that every view URL loads.
4. **Consumers onto the summary table:** Watch rows, the quick look and Portfolio columns.
5. **Portfolio limits and the earnings guard:**
   - limits in Settings;
   - breach counts;
   - the alert 5 sessions before earnings, through the alert pipeline with its snapshot.
6. **Later:** dividend comparison (price plus dividends), time-weighted portfolio result, screener on the summary table, Compare page, lazy chunks with a bundle budget.

## Open questions for Khaled

1. Checklist-2 (his choice, ADR 0046) dropped checklist-1's "size comes from the stop" and "profit plan" items. The Sahm ticket can now be copied without a sizing or target check. Restore those two items?
2. Confirm the 30% dividend withholding default (his broker's W-8BEN treatment).
3. His portfolio limits: largest position, top-5 share, minimum cash and maximum beta. Marsad shows "Set your limit" until he does.

## Consequences

- One page is added net (Portfolio). Regime becomes a view of Markets. Phone tabs stay at five plus More.
- Some in-flight work is rearranged rather than redone. Its core functions stay.
- TipRanks features cut for good: health score, smart score, crowd insights, buy/sell gauges, FAQ, after-hours movers, AI catalyst text and headline upside.
