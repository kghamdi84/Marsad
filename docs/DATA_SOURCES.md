# Data sources

Status as of 2026-11-23. Items marked **to confirm** are verified in Phase 1 with the Massive MCP `search_endpoints` tool or the publisher's own documentation, and a recorded fixture, before any adapter is written. Nothing here has been called by Marsad code yet.

## Massive (formerly Polygon.io), primary market data

License: individual plans are for individual use. Marsad is private, behind login, and never redistributes data.

Current plan: free tier (about 5 calls per minute). Entitlement test reported in the brief on 2026-11-23:

| Works on free                                  | Not entitled on free   |
| ---------------------------------------------- | ---------------------- |
| Previous-day aggregates                        | Last trade             |
| `/v2/reference/news` with per-ticker sentiment | Indices snapshot       |
| 8-K text                                       | Options chain snapshot |
| Form 4                                         | Financial ratios       |
| Treasury yields                                | Benzinga news          |
| Market holidays                                | Benzinga earnings      |

Plan ladder listed in the brief (Nov 2026, **to confirm** on massive.com/pricing before quoting a price): Stocks Advanced USD 199; Options Developer USD 79 (15-minute delayed); Options Advanced USD 199; Indices Starter USD 49 (delayed); Indices Advanced USD 99 (real-time VIX, VIX3M, SPX, NDX); partner datasets USD 99 each. A Stocks plan includes VXX but not the VIX index.

**Confirmed live 2026-11-24** (api.massive.com with `Authorization: Bearer <key>`): `/v1/marketstatus/upcoming`, `/stocks/v1/splits`, `/fed/v1/treasury-yields` on the free plan. Entitlement error, recorded 2026-11-24 (`fixtures/massive/not-entitled-403.json`): HTTP 403 with `{"status":"NOT_AUTHORIZED","request_id":"...","message":"You are not entitled to this data. Please upgrade your plan at https://massive.com/pricing"}`. The REST envelope is `status`, `request_id`, `queryCount`, `resultsCount`, `results`. Free-plan rate limit: about 5 calls a minute across every workflow using the key, so Massive workflows must not run at the same time (two overlapping runs on 2026-11-24 produced a 429).

**VWAP finding, 2026-11-24** (SPY, 5 sessions 2026-11-16 to 2026-11-20, 1-minute bars on the free plan via the Massive connector; n is small, one ticker): the vendor's daily-bar `vw` against three rebuilds.

| Rebuild from minute bars                   | Difference from daily `vw` | Verdict at the 0.1% tolerance |
| ------------------------------------------ | -------------------------- | ----------------------------- |
| Volume-weighted mean of the minute `vw`    | +0.002% to +0.074%         | Within, thin margin           |
| Typical price (high+low+close)/3, all bars | -0.002% to -0.413%         | Fails on 2 of 5 days          |
| Typical price, regular session 09:30-16:00 | -0.287% to +0.046%         | Fails on 3 of 5 days          |

The typical-price error grows with the day's range (4.57% range on 2026-11-20 gave -0.41%). Minute bars cover only 93.0% to 96.8% of the daily volume, so they are not a full tape. Consequences: the nightly check rebuilds VWAP from the minute `vw` field, not from OHLC; any rule that uses VWAP from `packages/core` `vwap()` (typical price) must expect it to differ from the vendor VWAP by up to about 0.4% on volatile days; rules should prefer `volumeWeightedPrice` over bar `vw` when minute bars carry it. The minute-versus-daily check is the vendor against itself at two aggregation levels, so it detects missing or corrupt bars, not a shared error in both.

**Free-plan entitlement for Study-module data, tested 2026-11-24 with real calls (via the Massive connector, same account as the key in GitHub; a Phase 2 job re-checks with the key itself):**

| Data                                                          | Free plan                                                                                                                                                                                                                                    |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Daily and minute bars, news, splits, dividends                | Yes (dividends: `/stocks/v1/dividends`, with split-adjusted amounts)                                                                                                                                                                         |
| Short interest (`/stocks/v1/short-interest`)                  | Yes: `settlement_date`, `short_interest`, `avg_daily_volume`, `days_to_cover`, from 2017 (twice a month, so it lags)                                                                                                                         |
| Short volume (`/stocks/v1/short-volume`)                      | Yes: daily `short_volume`, `total_volume`, `short_volume_ratio`, per venue (daily short volume is not short interest)                                                                                                                        |
| Income statements (`/stocks/financials/v1/income-statements`) | **Not entitled.** Financials come from SEC EDGAR XBRL company facts instead, which carry the filing date needed for point-in-time use                                                                                                        |
| Benzinga earnings, analyst ratings and guidance               | **Not entitled.** The earnings page shows "requires plan" for estimates, surprise and analyst actions; reported EPS and revenue come from SEC XBRL                                                                                           |
| 10-K sections (`/stocks/filings/10-K/vX/sections`)            | **Yes, confirmed with the project's own key** (recorder run 2026-11-24, `fixtures/massive/sections-NVDA-risk_factors.json`). Plain text of `risk_factors` and `business`. Coverage has gaps: NVIDIA returned fiscal 2026, 2025 and then 2017 |

Endpoint groups (paths from the brief; parameters and fields **to confirm**; `vX` paths are experimental and sit behind adapters with contract tests):

| Group                           | Paths                                                                                                                                    | Used for                              |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Prices                          | `/v2/snapshot/locale/us/markets/stocks/tickers`, `/v2/snapshot/locale/us/markets/stocks/tickers/{ticker}`, `/v2/aggs/...`, grouped daily | Watch, indicators, breadth            |
| Calendar                        | `/v1/marketstatus/now`, `/v1/marketstatus/upcoming`                                                                                      | Session state, holidays, early closes |
| Corporate actions               | `/stocks/v1/splits`, `/stocks/v1/dividends`, `/vX/reference/tickers/{id}/events`                                                         | Adjustment, ticker changes            |
| News                            | `/v2/reference/news`, `/benzinga/v2/news` (partner)                                                                                      | News stream                           |
| Filings                         | 8-K text and disclosures, 10-K sections, Forms 3, 4, 5, insider activity and holdings, 13F                                               | Study, catalysts                      |
| Fundamentals                    | `/stocks/financials/v1/income-statements`, `/stocks/financials/v1/ratios`                                                                | Study, quality screen                 |
| Earnings and analysts (partner) | `/benzinga/v1/earnings`, guidance, ratings, consensus; `/tmx/v1/corporate-events`                                                        | Calendars, Study                      |
| Short data                      | `/stocks/v1/short-interest` (FINRA, twice monthly), `/stocks/v1/short-volume` (daily, not short interest)                                | Study                                 |
| Macro                           | `/fed/v1/treasury-yields`, inflation, inflation expectations                                                                             | Regime                                |
| Options                         | `/v3/snapshot/options/{underlying}`, `/options/v1/analytics`, `/options/v1/open-interest/underlying`                                     | Options module                        |
| Indices                         | `/v3/snapshot/indices`                                                                                                                   | Market strip, regime                  |

### Risk-factor comparison between two 10-Ks (checklist 2.5)

Built on the vendor's section text so no filing HTML is parsed. Facts measured on the real NVIDIA pair (fiscal 2025 filed 2025-02-26, fiscal 2026 filed 2026-02-25), checked by an independent Python implementation written from the written rules:

- Each section is about 110 KB and 260 to 275 lines, one paragraph per line. The text keeps page furniture: bare page numbers, "Table of Contents" lines, and **sentences cut in two by a page break at different places each year**. That is why the comparison works on sentences, after removing the furniture and rejoining a line that stops mid-sentence (no closing punctuation, next line starts in lowercase).
- Result on the pair: 564 and 586 sentences; 449 unchanged, 71 new, 49 removed, 66 edited. Examples found: the new Groq licence risk, the dropped DGX Cloud risk, the rewritten China export-control text, the one-word edit "component" to "capacity" (Dice 26/28).
- The cut-off for "edited" (Dice 0.6 on word pairs) is a Marsad default, not a standard. On the same pair the edited count is 69 at 0.5, 66 at 0.6, 58 at 0.7 and 44 at 0.8; the unchanged count (exact matches) never moves. The lowest-scoring pairs at 0.6 (0.63 to 0.67) read as the same sentence edited.
- Known limits: the list at the top of Item 1A repeats each risk title, so a new risk can show twice; "U.S." before a capital letter splits a sentence the same way in both years, so it does not create false differences; a sentence cut by a page break at a full stop is still one sentence, but a risk rewritten into different sentences shows as removed plus new.
- The vendor's history has holes, so the panel compares only two reports a fiscal year apart (350 to 380 days).

## SEC structured data (confirmed on real NVIDIA responses, 2026-11-24)

- **Company facts** (`https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json`): every XBRL value with the filing that reported it (`accn`, `form`, `filed`). Findings that shape the code: the same period reappears in later filings (59 of 158 recorded periods did; none had a different value in this sample, so restatements are tested with a hand-built case); `fy` and `fp` describe the _filing_, so a comparison figure repeated in next year's 10-Q carries next year's labels and periods are identified by their dates; cash-flow items exist only as year-to-date totals (91, 182, 273 and 364 day periods), so quarters are derived by subtraction and marked derived; revenue is `Revenues` in recent filings and `RevenueFromContractWithCustomerExcludingAssessedTax` in older ones. Q4 flow figures are the year minus nine months. Diluted EPS for a derived quarter is an approximation, because share counts change.
- **Form 4 documents** (`/Archives/edgar/data/{cik}/{accession without dashes}/{document}.xml`): the filing index lists the rendered `xslF345X06/...xml` copy as the primary document; the raw XML is the same name without the `xsl...` folder. Elements: `documentType`, `periodOfReport`, `issuer/issuerCik`, `reportingOwner/reportingOwnerRelationship` (`isDirector`, `isOfficer`, `officerTitle`, `isTenPercentOwner`, `isOther`), `aff10b5One` (the 10b5-1 checkbox, per document and not per transaction), `nonDerivativeTable/nonDerivativeTransaction` and `derivativeTable/derivativeTransaction` (`transactionDate`, `transactionCoding/transactionCode`, `transactionAmounts/transactionShares`, `transactionPricePerShare`, `transactionAcquiredDisposedCode`, `postTransactionAmounts/sharesOwnedFollowingTransaction`, `ownershipNature/directOrIndirectOwnership`) and `footnotes`. A sales filing reports one row per price bucket at a weighted-average price (12 rows for 30,000 shares in the recorded filing). The three recorded filings all carried the 10b5-1 box and a footnote naming the plan and its adoption date; gifts (code G) carry a zero price.
- **Free-plan news** (`/v2/reference/news`) nests the publisher as an object (`publisher.name`); the connector's table output flattens it. Only three publishers appeared in 30 NVDA articles: The Motley Fool, Zacks Investment Research and GlobeNewswire. The REST response has `next_url` for paging.

## Free sources

| Source                                                     | What                                                                                                                                                         | Notes                                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| FRED API (free key)                                        | VIXCLS, T10Y3M, T10Y2Y, DGS10, BAMLH0A0HYM2, BAMLC0A0CM, NFCI, ICSA, SAHMREALTIME, USEPUINDXD, DCOILWTICO, DTWEXBGS; release dates for the economic calendar | Cross-checks Massive VIX and yields                                                         |
| SEC EDGAR                                                  | Filings and latest-filings feed                                                                                                                              | Fair access: declared User-Agent with contact email, rate well under 10 requests per second |
| Nasdaq Trader halts RSS                                    | Halts and resumptions, including T1 news-pending                                                                                                             | Feed URL and terms **to confirm**                                                           |
| Geopolitical Risk Index (Caldara and Iacoviello, AER 2022) | Daily index file                                                                                                                                             | Format and cadence **to confirm**                                                           |
| Federal Reserve                                            | FOMC meeting calendar                                                                                                                                        | Published yearly                                                                            |
| CNN Fear and Greed                                         | Optional cross-check only                                                                                                                                    | Only if accessible and terms allow; Marsad's own composite is primary                       |

## Disclosure lags (shown in the UI)

Form 4: within two business days of the trade. 13F: up to 45 days after quarter end. Short interest: twice a month, with a lag. Congressional trades: not used.

## Retention starting points

1-minute bars for the watch universe: 120 days. Daily bars: indefinitely. Derived options metrics: indefinitely. Raw option chains: not stored. News metadata: 2 years. Alerts and input snapshots: indefinitely.
