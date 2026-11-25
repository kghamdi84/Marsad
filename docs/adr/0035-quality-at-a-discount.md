# ADR 0035: The quality-at-a-discount screen

- Status: accepted
- Date: 2026-11-25
- Version: `quality-1`

## Context

The brief's long-term strategy 5 ("quality at a discount", activated by the capitulation watch) cites Graham, Novy-Marx ("The Other Side of Value", JFE 2013) and Asness, Frazzini and Pedersen ("Quality Minus Junk", RAS 2019). Marsad stores SEC company facts only for its ten watchlist stocks, too few and mostly unprofitable for a screen. The SEC's free XBRL frames API returns one reported figure for every filer in one request.

## Decision

- **Data**: each Sunday the quality-screen job reads 15 frames for the latest complete fiscal year (from April, the previous calendar year) from data.sec.gov, the SEC ticker list for CIKs, the Marsad universe (top 1,000 US common stocks by dollar volume) and the newest stored closes. Real frames recorded 2026-11-25 (fixtures/sec, trimmed to a dozen companies) showed that only some companies tag each primary figure, so each figure has a fallback chain, and every fallback used is named on the company's row: gross profit (GrossProfit, else revenue minus cost of revenue), net income (NetIncomeLoss, else ProfitLoss), equity (StockholdersEquity, else including noncontrolling interest), liabilities (Liabilities, else assets minus equity), shares (cover page, else balance sheet, else diluted weighted average).
- **Measures**: quality is the mean percentile of gross profits over assets, return on assets, low accruals ((net income minus operating cash flow) over assets) and low leverage (liabilities over assets); value is the mean percentile of the earnings yield and book-to-market, using the latest close times shares. A company passes at quality 70 or more and value 50 or more.
- **Exclusions, counted not hidden**: no SEC record, no gross profit by any route (banks, most insurers, some telecoms), unprofitable, negative equity, missing figures or no close.
- **Statistical honesty**: no ranking is published from fewer than 30 eligible companies. Scores are percentiles within the screened universe, not forecasts; no backtest of the screen is claimed.
- **Display**: the Regime page shows the passing companies (at most 20) after the capitulation watch, marked active when the watch is on and "for study, not as a signal" otherwise, with the counts and caveats.
- A failed SEC request fails the run and stores nothing.

## Consequences

- Market value mixes the latest close with year-end shares; buybacks or issuance since then are not reflected (stated on the page).
- A point-in-time backtest of the screen would need historical frames and closes; that is not built.
