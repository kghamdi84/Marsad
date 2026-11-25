# ADR 0020: Holdings, position sizer, Sahm ticket and exit conditions

- Status: accepted
- Date: 2026-11-25
- Version: `portfolio-1`

## Context

The brief's portfolio and discipline module: holdings entered by hand or by CSV with cost basis; a pre-trade checklist and position sizer (account size, risk per trade, stop distance, giving shares and reward-to-risk) with a "Copy Sahm order ticket" button producing plain text like `BUY 125 RKLB LIMIT 24.15, STOP 23.70, GTC`; and exit discipline per holding (stop, targets, trend break, thesis-break triggers, time stop). Marsad never places orders, and holding is never the default.

## Decision

- **Sizer** (`packages/core/src/portfolio.ts`): long trades; shares are the risk budget (account times risk, at most 5%) over the stop distance, rounded down, capped at 25% of the account in one position; reward-to-risk per target. Refuses impossible inputs with a plain reason.
- **Ticket**: the brief's exact format; prices to two decimals (half up). The copy button stays disabled until all five Jimmy D checklist items are ticked (clean setup, not extended, risk defined, profit plan, bear case read).
- **Holdings**: a personal table (owner with MFA writes it from the app); a CSV import with the header `ticker,shares,cost_basis,opened_on[,stop,targets,trend_break,time_stop_sessions]` that names every faulty line and adds nothing while any line is faulty. Closing a holding marks it closed; nothing is deleted.
- **Exit conditions**, checked on the newest completed daily bar: close at or below the stop, at or above a target, below the trend-break average, or the time stop reached without a target. A holding without a stop or target is flagged.

## Consequences

- Options positions, exposure and stress views, and exit alerts fired by a job (through the ADR 0019 pipeline) are next; thesis-break triggers are free text until catalyst watch can match them.
