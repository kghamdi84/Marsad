# ADR 0038: ETF holdings from SEC Form N-PORT for overlap and look-through

- Status: accepted
- Date: 2026-11-25
- Version: `etf-1`, then `etf-2` (2026-11-28, addendum below)

## Context

Checklist 7.3 asks for ETF overlap. The current data plans have no ETF constituent data. Funds file Form N-PORT with the SEC every month; the third month of each fiscal quarter is made public (NPORT-P) up to 60 days later, with every holding's name, CUSIP, ISIN, value in USD, percentage of net assets and asset category. SPY (SPDR S&P 500 ETF Trust, CIK 884394), QQQ (Invesco QQQ Trust, CIK 1067839) and DIA (SPDR Dow Jones Industrial Average ETF Trust, CIK 1041130) are single-fund trusts, so their newest NPORT-P is the fund's own. IWM's trust files for many funds and needs a series filter; it is left out.

The reports recorded on 2026-11-25: SPY and QQQ as of 2026-06-30, DIA as of 2026-07-31 (504, 105 and 30 holding lines).

## Decision

- **Job** (`sec-etf-holdings`, weekly SEC workflow): for each fund, read the SEC submissions list, take the newest NPORT-P, skip it when its accession is stored, otherwise download the raw XML (the listed document without its stylesheet folder) and store the report header and every holding with its rank by weight.
- **Ticker matching** (`matchTickers`): equity holdings only, by company-name key against the SEC ticker list; a key shared by several tickers (share classes) stays unmatched rather than guessed. CUSIPs are stored for every holding.
- **Overlap** (`etfOverlap`): the sum, over securities shared by CUSIP, of the smaller weight. 1 means identical holdings in identical weights.
- **Look-through** (`lookThrough`): for each stock held directly, the dollars held through each covered fund (fund position value times the stock's weight in the fund), next to the direct dollars.
- **Display**: the Journal shows each fund's report date and match count, the pairwise overlap and the look-through table, with the source, formula version and the N-PORT disclosure lag.

## Verification

`jobs/src/etf-job.test.ts` runs the job on the three real reports and checks: holding counts, report dates, NVIDIA's weight by CUSIP in SPY (7.517%) and QQQ (7.597%), its match to NVDA, and the three overlaps against an independent Python calculation on the same files (SPY and QQQ 53.7109%, SPY and DIA 27.9772%, QQQ and DIA 20.18%), tolerance 1e-6.

## Consequences

- Weights are up to about five months old (quarter end plus 60 days, plus up to a quarter before the next one); every figure carries its report date.
- Funds other than SPY, QQQ and DIA contribute nothing to look-through. Adding a single-fund trust is one line in `ETF_TRUSTS`.

## Addendum 2026-11-28: CUSIP matching through OpenFIGI (`etf-2`, `openfigi-1`)

Name matching left 128 of SPY's 504 holding lines without a ticker, so a breadth check over the S&P 500 (checklist
3.3) covered only 376 members. `etf-2` maps each common-stock CUSIP to its US composite ticker through OpenFIGI's
free mapping API (`POST https://api.openfigi.com/v3/mapping`, no key: 10 jobs a request, 25 requests a minute,
checked 2026-11-28; real reply in `fixtures/openfigi/mapping-cusip-us.json`). Share classes come back with a slash
(BRK/B) and are stored with a dot (BRK.B), as Marsad's bars write them. A CUSIP with no US equity listing, or with two
different US tickers, stays unmatched; the company-name match is used only for those. If OpenFIGI fails, the job
falls back to names and records why in the run details. Reports matched under `etf-1` are downloaded and matched
again on the next run. No cost. With the `OPENFIGI_API_KEY` GitHub secret (added by Khaled 2026-11-28, sent as
`X-OPENFIGI-APIKEY`, never logged) the job sends 100 CUSIPs a request, one request every 0.3 seconds (limit 250 a
minute); without it, 10 CUSIPs every 2.6 seconds.
