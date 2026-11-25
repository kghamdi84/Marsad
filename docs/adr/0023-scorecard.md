# ADR 0023: The scorecard

- Status: accepted
- Date: 2026-11-25
- Version: `scorecard-1`

## Context

The brief asks for every alert's outcome at +1 hour, +1 day, +5 days and +20 days against its benchmark, with maximum favorable and adverse excursion and whether the stop or target was hit; per-rule expectancy, calibration of the quality score, and shadow against live. Phase 7 is done when every scorecard figure can be recomputed from raw alert outcomes by a test. Only end-of-day bars are available.

## Decision

- **Outcomes** (`scorecard.ts`, table `alert_outcomes`, job `scorecard` after each bars run): for each alert of the last 45 days, the reference is the close of the newest session that had closed when the alert fired (16:00 ET). Horizons are 1, 5 and 20 sessions. Returns are signed in the alert's direction: setups point up, exits point down (an exit is right when the price falls); halts, regime and system alerts make no directional call and are stored as unavailable. SPY over the same sessions, signed the same way, gives the excess. Excursions use the window's highs and lows. With a plan, the first level touched is recorded; a bar that touches both counts as the stop (conservative).
- **The +1 hour horizon** needs intraday bars, which the current plan does not include: the page says so instead of showing a number.
- **Stored, then summarized**: outcomes are stored per alert and horizon; finished rows are never recomputed, pending ones refresh nightly. Every summary (n, wins, win rate with a 90% Wilson interval from 30 cases, mean return as the expectancy per alert before costs, mean excess, mean excursions, stop and target counts) is computed in the browser from those rows by `summarize`, grouped by rule and by live or shadow status.
- **Calibration**: win rate by equal-width quality-score bins at 5 sessions, shown once 30 scored alerts carry a score. No rule produces a quality score yet, and the page says so.
- **Tests**: hand-checked outcomes (reference session, signed returns, excursions, first touch, ties), the done-criterion test (every summary and calibration figure equals a plain recomputation from raw outcomes over 80 seeded alerts), the 29 and 30 case boundary, a job test, an RLS test and a browser test. Mutation-checked; the one surviving mutation is equivalent (pending outcomes have no return by construction).

## Consequences

- With only halt and exit alerts today, the scorecard fills slowly; most rows will read "insufficient history" for months. That is the honest outcome.
