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

## Tauric (Tauric Research), second quote source (ADR 0041)

Measured 2026-11-26 through the Tauric connector (Standard tier) and the public `https://api.tauric.ai/openapi.json`; recorded in `fixtures/tauric/quotes-2026-11-26.json`.

- REST: `POST https://api.tauric.ai/v1/quotes` with `Authorization: Bearer <key>`, body `{"instruments": ["security:AAPL", ...]}` (1 to 50 keys), answer `{object, next_cursor, data, errors}`. Errors are `{"error": {"type", "code", "message", "param", "retry"}}`; codes include `invalid_api_key`, `entitlement_required`, `rate_limit_exceeded` and `quota_exhausted`.
- Limits: 3,000 data credits a day (one per successful request), 60 requests a minute; keys and the website share them. No price is published for the Standard tier.
- Agreement with Massive: the 2026-11-25 closes of AAPL (355.58), NVDA (149.30) and SPY (716.70) matched Massive grouped daily to the cent. Session volume was 2.3% (AAPL) and 1.9% (NVDA) lower; opens differ by a few cents (AAPL 353.5875 against 353.475).
- Not given: the delay for US stocks (unpublished), stock bid and ask (always null), live intraday bars (15-minute and hourly bars are added at the end of each session), CIK or FIGI on the quote. Crypto is quoted in USDT, not USD.
- Misleading field: `price_age_seconds` is the age at Tauric's last refresh. An FX quote read at 14:41 UTC said 5 seconds and `stale: false` while it was from 14:10. Marsad ignores it and its `stale` flag.
- Terms (tauric.ai/terms, effective 2026-11-11): display in your own applications is allowed; no resale, no sharing of keys; no SLA, and the service may change or stop at any time.

## Regime inputs: what the free data reaches (measured 2026-11-25)

- **VIX3M is free on FRED** (`VXVCLS`, daily from 2007-12-04), so the VIX term structure (VIX over VIX3M) needs neither the Massive Indices plan nor the VXX fallback. VIX itself is `VIXCLS` (from 1990).
- **The S&P 500 on FRED (`SP500`) keeps only 10 years** (from 2016-11-25 on the day measured). The regime label therefore starts in November 2017 (252 sessions of warm-up), and most event-study conditions have fewer than 30 independent episodes. Options to deepen it are in ADR 0009.
- **The ICE BofA high-yield and investment-grade spreads keep only 3 years on FRED** (from 2023-11-27), a licensing limit. The recession filter's credit signal is unavailable before then and says so.
- Long histories that are free: 10-year minus 3-month (1982), NFCI (1971), initial claims (1967), the real-time Sahm rule (1959), daily EPU (1985), and the Nasdaq Composite (`NASDAQCOM`, 1971; a possible labelled proxy, not used).
- **Massive grouped daily** (`/v2/aggs/grouped/locale/us/market/stocks/{date}`) works on the free plan through the connector: one call returned 12,650 US tickers for 2026-11-24. That makes the 1,000-stock breadth universe affordable at one call per day (to confirm with the project key in the breadth job; the free plan reaches back 2 years).
- **Breadth endpoints, confirmed with the project key** (recorder run 2026-11-25, `fixtures/massive/grouped-*`, `splits-*`, `tickers-*`): grouped daily with `adjusted=false` returned 12,650 tickers for 2026-11-24 with `status: "DELAYED"` (fine for end of day); the 1,000th largest by that day's dollar volume traded USD 139.8 million, and 9,418 tickers traded at least USD 100,000. All-market splits: 261 between 2026-10-01 and 2026-11-24 (stock dividends included), one page at `limit=5000`. Ticker lists by type take a `date` (point in time) and page by 1,000 with a `cursor` in `next_url`. Storage and rules are in ADR 0010.
- **Fear and Greed inputs** (ADR 0011): FRED SP500, VIXCLS, BAMLH0A0HYM2 and BAMLC0A0CM; Marsad universe breadth; Massive daily bars for SPY and IEF (IEF is stored for this only, one extra call a day in the bars job). **Put/call ratio: no source** on the current plans (Massive options data needs a paid options plan; Cboe no longer publishes free daily put/call files), so the composite shows at most 6 of 7, and 5 of 7 until stock price strength has a year of history.
- **Market-wide news** (ADR 0012, confirmed 2026-11-25): `/v2/reference/news` without a ticker returns all news, about 500 articles a day, almost all investment press (The Motley Fool, Zacks, GlobeNewswire), no wire services; pages of 1,000 with `next_url`. Used only for daily topic counts. GLD, ITA and IYT daily bars are stored for the geopolitical panel (three more calls a day in the bars job). FRED DCOILWTICO (WTI) and DTWEXBGS (broad dollar) were already stored by the FRED job.
- **Publication lags** are applied before any value is used: claims 5 days after the week, NFCI 5 days, the Sahm rule from the 10th of the next month (ADR 0009).

## SEC structured data (confirmed on real NVIDIA responses, 2026-11-24)

- **Company facts** (`https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json`): every XBRL value with the filing that reported it (`accn`, `form`, `filed`). Findings that shape the code: the same period reappears in later filings (59 of 158 recorded periods did; none had a different value in this sample, so restatements are tested with a hand-built case); `fy` and `fp` describe the _filing_, so a comparison figure repeated in next year's 10-Q carries next year's labels and periods are identified by their dates; cash-flow items exist only as year-to-date totals (91, 182, 273 and 364 day periods), so quarters are derived by subtraction and marked derived; revenue is `Revenues` in recent filings and `RevenueFromContractWithCustomerExcludingAssessedTax` in older ones. Q4 flow figures are the year minus nine months. Diluted EPS for a derived quarter is an approximation, because share counts change.
- **Form 4 documents** (`/Archives/edgar/data/{cik}/{accession without dashes}/{document}.xml`): the filing index lists the rendered `xslF345X06/...xml` copy as the primary document; the raw XML is the same name without the `xsl...` folder. Elements: `documentType`, `periodOfReport`, `issuer/issuerCik`, `reportingOwner/reportingOwnerRelationship` (`isDirector`, `isOfficer`, `officerTitle`, `isTenPercentOwner`, `isOther`), `aff10b5One` (the 10b5-1 checkbox, per document and not per transaction), `nonDerivativeTable/nonDerivativeTransaction` and `derivativeTable/derivativeTransaction` (`transactionDate`, `transactionCoding/transactionCode`, `transactionAmounts/transactionShares`, `transactionPricePerShare`, `transactionAcquiredDisposedCode`, `postTransactionAmounts/sharesOwnedFollowingTransaction`, `ownershipNature/directOrIndirectOwnership`) and `footnotes`. A sales filing reports one row per price bucket at a weighted-average price (12 rows for 30,000 shares in the recorded filing). The three recorded filings all carried the 10b5-1 box and a footnote naming the plan and its adoption date; gifts (code G) carry a zero price.
- **Form 3 and Form 5 documents** (same URL pattern and the same `ownershipDocument` root as Form 4; recorded 2026-11-24 from the 10 tracked companies, `fixtures/sec/form3-*`, `form3A-*`, `form5-*`, `form5A-*`). The recent filings of the 10 companies list 263 of them (243 Form 3, 6 Form 3/A, 12 Form 5, 2 Form 5/A), so they are common. Findings that shape the code:
  - **A Form 3 reports holdings, not trades.** Rows are `nonDerivativeHolding` (shares owned) and `derivativeHolding` (an option or restricted stock units, with the shares it converts into). The report's `periodOfReport` is the date the person became an insider; Form 3 is due within 10 days (a recorded one was filed 8 days later).
  - **`noSecuritiesOwned` is an explicit statement** (a recorded Form 3 for a new Hims & Hers director says `1` and has empty tables). It is stored and shown as a fact, never as missing data.
  - **Restricted stock units give no price and no dates as values**, only footnote references (`conversionOrExercisePrice` holds a `footnoteId`); options give a price and an expiration date but no exercise date value. The parser returns null for what the filing does not state, and the page says "Not stated, see the filing notes" and shows the footnote text (which says, for example, that each unit is a right to receive one share).
  - **A Form 5 can report trades from years earlier.** A recorded amended Form 5 (5/A) for an NVIDIA director, filed 2025-03-21, reports two sales made on 2023-12-13 and 2024-06-14, each marked late by the filer (`transactionTimeliness` L), through a family trust (indirect ownership). That is why the page shows the trade date and the filed date side by side and why the 90-day totals go by trade date.
  - **Amendments can repeat an earlier filing** (`dateOfOriginalSubmission` names the original). Their lines are listed but not added to the totals, because the original may or may not be stored and adding both would count a trade twice.
  - **A joint filing names several reporting owners** (a recorded Form 3/A has four: three Google Ventures entities and Alphabet). The table keeps the first in `owner_name` and the rest in `co_owners`.
  - **Form 4 documents carry holdings rows too** (a director's Form 4 lists 57,378 shares directly and 4,852,480 through a profit-sharing plan trust). They are now stored; the page does not show them yet.
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
