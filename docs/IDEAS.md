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
