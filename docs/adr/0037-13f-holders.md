# ADR 0037: Institutional holders from the SEC Form 13F data sets

- Status: accepted
- Date: 2026-11-25
- Version: `holders-1`

## Context

Checklist 2.3 and 2.4 ask for 13F holders with a lag label. The data vendor serves 13F filings by the fund that filed them, not by the stock. The SEC publishes the Form 13F data sets for free: one zip per three-month filing window with INFOTABLE (every reported position), SUBMISSION (period, filing date, type) and COVERPAGE (manager name, amendment flag). The newest one recorded on 2026-11-25 (filings June to August 2026) has a 396 MB INFOTABLE with 3.8 million lines.

## Decision

- **Job**: the weekly SEC workflow lists the data sets on the SEC page and downloads the newest one only when it is not stored yet. INFOTABLE is streamed line by line through `unzip` (never loaded whole), keeping only the watchlist companies' lines.
- **Matching** (`holders.ts`): by issuer-name words, not CUSIP or FIGI. The recorded sample showed issuer names vary ("NVIDIA CORPORATION", "NVIDIA CORP", "NVIDIA Corp"), FIGIs are rarely filled in, and Rocket Lab appears under its new CUSIP (773121108, ROCKET LAB CORP) and its pre-redomicile CUSIP (773122106, ROCKET LAB USA INC). A company's key is its SEC name without legal suffixes; issuer names must start with every key word as whole words (MARA matches MARA HOLDINGS, not MARATHON OIL). Every CUSIP counted is stored and shown with its issuer name.
- **What counts**: original 13F-HR reports for the newest quarter in the data set; common-share lines only. Options, principal amounts, warrants (including "*W EXP" titles), notes and preferred shares are left out, as are amended reports and late filings for older quarters; each is counted and shown.
- **Display**: the company page shows the period, the disclosure lag (positions on the quarter end, filed up to 45 days later), the number of filers, total shares and value, and the top 20 filers with their share of the reported total.

## Consequences

- Amendments that add holdings are left out rather than merged; the count says how many.
- A company whose name does not match its issuer name in 13F filings gets no list; the run details name it.
- Quarter-over-quarter changes per filer are possible once a second quarter is stored; not built.
