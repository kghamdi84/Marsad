# ADR 0040: Friends as members

- Status: accepted (Khaled's request on 2026-11-25)
- Date: 2026-11-25

## Context

Khaled wants to share Marsad with some friends, who create their own accounts. Asked what friends should see, he chose: everything, including prices from Massive, whose plans are labelled "Individual use only" on massive.com/pricing (checked 2026-11-25), accepting that risk himself; and his own signals private.

## Decision

- **Accounts.** The sign-in screen has a "Create an account" form (email and password, at least 10 characters). Supabase Auth must allow sign-ups and, while its built-in email sender is rate limited, not require email confirmation (SETUP step 2c). The emailed link never creates an account.
- **Members.** `private.is_member()`: any signed-in user (with `private.is_mfa()`, which honours the ADR 0039 switch). Every shared table's read policy uses it: market data, research, regime, breadth, calendars, quality screen, ETF and 13F holdings, rules and backtests, job runs and source status.
- **Owner-only.** Alerts, alert outcomes, briefs (they name Khaled's holdings), AI usage, push devices and system alerts keep `private.is_app_owner()`; a schema test fails if any of them loses it.
- **Personal tables** were already filtered by `owner_id = auth.uid()`: each member has their own holdings, trades, journal, theses, watchlists, settings, option positions and catalyst scenarios.

## Consequences

- Massive's terms: sharing its prices with friends may breach "Individual use only"; Khaled accepted this risk.
- With confirmation off, anyone who has the site link can create an account and read the shared data. The site is noindex. An invitation list is the next step if that matters.
- Friends see empty Alerts and brief panels; alerts are generated for Khaled's watchlist and holdings only.
