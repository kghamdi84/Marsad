# ADR 0017: Point-in-time backtester

- Status: accepted (starting rules; every change bumps the version)
- Date: 2026-11-25
- Version: `backtest-1`

## Context

The brief requires point-in-time research (signals on completed bars, entry on the next bar, no look-ahead or survivorship bias, realistic costs), statistical honesty (bootstrap 90% intervals, walk-forward testing with an untouched holdout, trial counts and the deflated Sharpe ratio, a benchmark and a regime breakdown, no percentage from fewer than 30 cases), Monte Carlo drawdowns, and determinism (two runs with the same seed give identical output).

## Decision

- **Mechanics** (`packages/core/src/backtest.ts`, using the `rule-dsl-1` evaluator): an entry condition true on a completed bar enters at the next bar's open. While in the trade, each bar first checks the stop (fixed at entry: a fraction of the entry price, or a multiple of ATR(14) from the signal bar); a low at or below it exits at the stop, or at the open when the bar opens below it. An exit condition or the time stop (`maxHoldBars`, counting the entry bar) exits at the next open. One position at a time; a new signal can come on the exit bar. Data that ends with a trade open closes it at the last close and marks it open; reports leave open trades out.
- **Costs**: commission, slippage (about half the spread) and currency conversion, each in basis points per side; the net return is `exit * (1 - c) / (entry * (1 + c)) - 1`. Defaults 5, 5 and 0 basis points; the Lab shows the costs used.
- **Report**: trade statistics (`stats-1`), bootstrap 90% intervals of expectancy and win rate (only from 30 closed trades), buy-and-hold benchmark over the same dates, a breakdown by regime label at the signal date (a value only from 30 trades), and Monte Carlo maximum drawdowns from 1,000 seeded resamples of the trade order (median and worst 5%).
- **Walk-forward**: anchored folds (each trains on everything before its test window) and a final holdout (20% by default). In each fold the variant with the best training Sharpe is chosen and only its test-window trades count. Every variant is a trial; the deflated Sharpe ratio uses the trial count and the variance of the variants' training Sharpes. The holdout is computed only when explicitly revealed, with the variant chosen last.
- **Survivorship**: the backtester takes the bars it is given; universe-wide tests use the point-in-time Marsad universe (ADR 0010), which keeps delisted names for the months they traded.

## Consequences

- Known answers: hand-checked cases (entry, exit, stop at and below the open, time stop, re-entry after a stop, costs) and an independent Python backtester on 600 seeded synthetic bars (14 trades, one stop) match exactly. Look-ahead: changing bars after a cut never changes a trade closed before it. Mutation-checked.
- Daily bars only: intraday rules (playbook 11) wait for intraday data.
