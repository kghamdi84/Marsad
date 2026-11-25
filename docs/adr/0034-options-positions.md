# ADR 0034: Options positions entered by hand

- Status: accepted
- Date: 2026-11-25
- Version: `options-pos-1`

## Context

Checklist 7.1 asks for holdings and options positions. Stock holdings exist (ADR 0020). Options quotes need the options data plan, which is Khaled's decision, but a position placed in Sahm can be recorded and its risk computed from its legs now.

## Decision

- **Table**: personal `option_positions` (MFA): underlying, name, one expiry, 1 to 4 legs (call or put, strike, signed contracts, premium per share), opened date, exit rules (days to expiry, profit take and loss limit as shares of the maximum gain and loss) and a required bear case. The database refuses a position without an exit rule, without a bear case or with 0 or more than 4 legs; positions are closed, not deleted.
- **Defined risk only**: the app refuses any structure whose maximum loss is unlimited (`payoffSummary` from `options-1`), as the brief allows only defined-risk structures.
- **What code says now**: debit or credit, maximum loss and gain, breakevens, calendar days to expiry, and the result at expiry if the underlying stays at its last stored close (labeled with that close's date). The time exit is judged from the calendar; a short leg in the money at the last close within 7 days of expiry raises an assignment-risk line.
- **What code does not say**: the position's value today. Without option quotes it is shown as unavailable, and the profit take and loss limit are restated with their dollar levels, never judged. Calendars and diagonals (several expiries) are not supported in this version.

## Consequences

- With the options plan, the same table gains marks, Greeks and judged profit-take and loss-limit rules without a migration.
