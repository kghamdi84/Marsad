# ADR 0016: Statistics and the rule language

- Status: accepted
- Date: 2026-11-25
- Versions: `stats-1`, `rule-dsl-1`

## Context

Phase 4 builds the backtest lab. The brief requires one calculation engine shared by the lab and live alerts, rules as JSON documents that are versioned and immutable once live, point-in-time evaluation (signals on completed bars, entry on the next bar), and statistical honesty: bootstrap 90% intervals, the deflated Sharpe ratio with trial counts, Wilson intervals for loss rates, and no percentage from fewer than 30 cases.

## Decision

### Statistics (`stats-1`, `packages/core/src/stats.ts`)

- Normal CDF (West's double-precision algorithm) and its inverse (Acklam plus one Halley step); Wilson score interval (90% by default); a seeded generator (mulberry32) and a percentile bootstrap (type 7 quantiles, 2,000 resamples by default); mean, sample standard deviation, skewness and kurtosis (population moments, as scipy's defaults); Sharpe (per period, risk-free 0, annualized on request); the deflated Sharpe ratio (Bailey and Lopez de Prado, 2014); maximum drawdown of the compounded curve; trade statistics with a `sufficient` flag at 30 cases.
- Known answers: scipy 1.18, statsmodels 0.15 and numpy 2.5 (`fixtures/stats/reference.json`), within 1e-9 or tighter; the bootstrap matches numpy on the same seeded draws exactly. Mutation-checked.

### Rule language (`rule-dsl-1`, `packages/core/src/rules.ts`)

- A rule has an id, a name, `side: long`, an entry condition, and at least one way out: an exit condition, a stop (a fraction of the entry price, or a multiple of ATR(14) at entry) or a time stop (`maxHoldBars`).
- Conditions: `all`, `any`, `not`, and comparisons (`>`, `>=`, `<`, `<=`, `crossesAbove`, `crossesBelow`) of expressions: a number, a bar field (open, high, low, close, volume) with an optional offset, `sma`, `ema`, `highest`, `lowest` and `return` over a period, `rsi`, `atr` and `rvol` over a period, and `mul` of two expressions. Periods and offsets run from 1 (or 0) to 400; nesting is limited to 12 levels.
- A missing value (not enough history) makes a comparison unknown, not false; `all` is false as soon as one part is false, `any` true as soon as one is true. A cross needs the previous bar on or below (above) the line and the current bar above (below) it.
- The evaluator only reads bars up to the one it judges; a property test changes every bar after 50 random cut points and checks that no earlier signal changes.
- Versions: `canonicalRule` sorts keys; `ruleHash` (FNV-1a) identifies a version's content. The lifecycle tables store each version immutably (batch D).

## Consequences

- Short rules, intraday bars and options rules are out of scope for `rule-dsl-1`; they arrive as new versions when live data allows them.
- The backtester (next batch) uses this evaluator, so a backtest tests the same code that will fire live alerts.
