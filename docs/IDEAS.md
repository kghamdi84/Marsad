# Ideas for later phases

Captured during work so they are not built early.

- Phase 1: add `supabase/config.toml` when the Supabase CLI deploy workflow arrives, mirroring the dashboard auth settings (sign-ups off, TOTP on, OTP length 6).
- Phase 1: link `watchlist_items` to an instrument identity table (CIK, FIGI) instead of a bare ticker.
- Phase 1: a live RLS smoke test against the real project (two test users, run from GitHub Actions with the secret key), complementing the offline PGlite suite.
- Phase 5: custom SMTP sender for auth emails and digests (the built-in Supabase sender is rate limited), and a code-only (`{{ .Token }}`) Magic link template so sign-in works inside the installed PWA (ADR 0005 revision).
- Phase 8: code-split the web bundle per module once modules exist.
- Phase 1: confirm the Nasdaq Trader terms of use for polling the halts feed.
- Phase 1: time-of-day adjusted RVOL for intraday bars (the current RVOL compares with the previous N bars).
- Phase 1: a Python-free GPR conversion if a maintained, license-clean `.xls` reader for Deno or Node appears.
- Phase 3: widen the VWAP reconciliation beyond SPY (a handful of liquid tickers) and revisit the 0.1% tolerance once there are 30 or more sessions; the 5-session margin (max 0.074%) is thin.
- Phase 5: VIX against FRED `VIXCLS` needs the Massive Indices plan (not entitled on free); decide with the plan purchase.
- Phase 2: filings completeness (stored EDGAR filings against a second feed such as the EDGAR current-filings Atom feed) once the Study module defines which forms matter.
- Phase 2: the SEC job stores only the `filings.recent` list, so quarters older than about a year have no results 8-K and the earnings history says so. Load the older `submissions` files (the `filings.files` entries) to fill them, which also lengthens the filings list.
- Phase 2: show earnings releases as chart markers (the release is known; the marker would sit on the reacting bar).
- Phase 2: 10-Q risk-factor updates and the Item 1 business text (the vendor endpoint also serves `business`); a 10-Q comparison needs a different source because the sections endpoint is 10-K only.
- Phase 2: tune the risk-diff cut-off (0.6) on more companies once the weekly job has stored them all, and drop the duplicate summary-list sentences if they prove noisy.
- Phase 2: the vendor's `/stocks/insiders/vX/holdings` (roster of insiders with the shares each holds now, one row per owner per issuer) could give a "current holdings" view without adding up filings; entitlement not yet checked. The Form 4 and Form 5 holdings rows the insiders job now stores (for example a director's direct and indirect stakes) are another source for it.
- Phase 2: 13F holders of a stock need the SEC quarterly 13F data sets (the vendor's endpoint is by filing fund), a larger job: download, join by CUSIP to the stock, label the 45-day lag.
- Phase 2: show a transaction's own timeliness flag (the filer marks a trade "L" for late) and the nature of ownership on trades (a sale through a family trust is indirect); both are in the documents and not yet stored.
- Phase 3/4: the regime-1 label changes 316 times over 2,512 sessions (about 32 times a year), mostly around VIX 30 and the VIX/VIX3M crossing. A confirmation rule (for example two closes in a row) would steady it; any such change is a new rule version and counts as a trial in Phase 4.
- Phase 3: a longer event-study history (Massive Stocks Advanced for SPY since the 2000s, or the Nasdaq Composite as a labelled proxy) once Khaled decides; ADR 0009 lists the options.

- Put/call ratio for the Fear and Greed composite (7 of 7) once an options plan is approved (Phase 5 builds put/call ratios anyway).
- Cross-check Marsad's composite against CNN's published Fear and Greed reading, if its terms allow (the brief lists it as optional).
