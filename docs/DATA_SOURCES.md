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

| Data                                                          | Free plan                                                                                                                                          |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Daily and minute bars, news, splits, dividends                | Yes (dividends: `/stocks/v1/dividends`, with split-adjusted amounts)                                                                               |
| Short interest (`/stocks/v1/short-interest`)                  | Yes: `settlement_date`, `short_interest`, `avg_daily_volume`, `days_to_cover`, from 2017 (twice a month, so it lags)                               |
| Short volume (`/stocks/v1/short-volume`)                      | Yes: daily `short_volume`, `total_volume`, `short_volume_ratio`, per venue (daily short volume is not short interest)                              |
| Income statements (`/stocks/financials/v1/income-statements`) | **Not entitled.** Financials come from SEC EDGAR XBRL company facts instead, which carry the filing date needed for point-in-time use              |
| Benzinga earnings, analyst ratings and guidance               | **Not entitled.** The earnings page shows "requires plan" for estimates, surprise and analyst actions; reported EPS and revenue come from SEC XBRL |

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
