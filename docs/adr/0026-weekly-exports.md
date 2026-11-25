# ADR 0026: Weekly exports to private Storage

- Status: accepted
- Date: 2026-11-25
- Version: `exports-1`

## Context

The brief asks for weekly exports of Khaled's journal, holdings, rules and scenarios to Storage, so his own records survive any mistake in the app or the database.

## Decision

- A job (`exports`, Sundays 07:10 UTC, workflow `weekly-exports.yml`) reads with the secret key every personal table (holdings, trades, theses, watchlists, watchlist items, alert feedback, settings) and the shared rule library (rules, rule events, backtest runs), and writes one JSON file per table plus `manifest.json` to `exports/<owner id>/<date>/`. The manifest lists each table's row count, size and FNV-1a hash (checked against the published test vectors), so a restore can be verified.
- The bucket is private and accepts only JSON. One policy lets the owner, with MFA, read their own folder; no signed-in user can write or delete exports. The Status page lists the last 12 exports and saves a file through a local `blob:` URL (no CSP change).
- "Scenarios" in the brief are the stress scenarios, which are computed from holdings and bars, so the exported holdings reproduce them.

## Consequences

- Exports accumulate (a few kilobytes a week); pruning is left until they matter.
- Screenshots are not copied into exports; they stay in the `journal` bucket.
