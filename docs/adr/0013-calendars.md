# ADR 0013: Economic and earnings calendars

- Status: accepted (starting rules; every change bumps the version)
- Date: 2026-11-25
- Version: `calendar-1`

## Context

The brief asks for economic and earnings calendars (Phase 3), "today and this week, with impact level and countdown", using FRED's release-dates API and the Federal Reserve's FOMC calendar, and watchlist earnings for the weekly outlook. Checked on 2026-11-25: Massive's earnings calendars (Benzinga, Wall Street Horizon) are not on the current plan (NOT_ENTITLED).

## Decision

- **Economic events**: FRED `/fred/releases/dates` with `include_release_dates_with_no_data=true` for the next 60 days (1,040 dates over 10 weeks on 2026-11-25, so paged by 1,000 with `offset`), filtered to ten tracked releases. Each is matched by FRED release id and name, so a renumbered release is dropped rather than mislabelled. FRED gives dates only; each release shows its agency's usual time (08:30 ET for CPI, jobs, GDP, PCE, PPI, retail sales, claims and housing starts; 10:00 ET for JOLTS and consumer sentiment).
- **Impact**: high for CPI, the jobs report, GDP, PCE and FOMC statements; medium for PPI, retail sales, claims and JOLTS; low for consumer sentiment and housing starts.
- **FOMC**: the meetings of 2026 and 2027 from the Federal Reserve's calendar page (read 2026-11-25), statement at 14:00 ET on the last day, with projections where the Fed marks them. Updated by hand each year.
- **Earnings**: estimated for each watchlist company from its own stored SEC 8-K item 2.02 filings: the release that followed last year's counterpart of the latest one, plus 52 weeks (same weekday), shown with a week either side; with less than a year of history, 13 weeks after the latest. Labelled "estimated", never presented as confirmed; an estimate more than a week past without a newer filing is marked overdue.
- **Storage**: append-only snapshots (`econ_calendar_snapshots`, `earnings_estimate_snapshots`), one row each per run of the calendar job (after the FRED job, 23:30 UTC); the page reads the newest. A rescheduled release never leaves a stale date, and nothing is deleted.
- **Display**: the Watch page, ET time with local time beside it, a countdown for today's events, the next 14 days.

## Consequences

- No confirmed earnings dates or consensus estimates until a paid earnings source is approved.
- The FOMC list needs a yearly update (the 2028 schedule is published in 2027); IDEAS.md tracks it.
- Usual times can differ on rare occasions (for example a government shutdown delaying a release); FRED's date is authoritative, the time is the usual one.
