# ADR 0021: Options math ahead of options data

- Status: accepted
- Date: 2026-11-25
- Version: `options-1`

## Context

Phase 6 builds options and earnings intelligence on Massive's Options Developer plan (USD 79 a month, delayed), which Khaled has not chosen yet. The math does not depend on the data: prices, greeks and implied volatility, expected move, IV rank and percentile, payoffs of defined-risk structures, and the liquidity guard. The brief's done-criterion for Phase 6 includes "expected-move and payoff functions pass their known-answer tests".

## Decision

- `packages/core/src/options.ts`: Black-Scholes-Merton with a continuous dividend yield (price, delta, gamma, vega per 1.00 of volatility, theta per year, rho); implied volatility by Newton steps on vega with a bisection fallback, null outside the no-arbitrage bounds; expected move from the at-the-money straddle mid; IV rank (between the period's low and high) and IV percentile (share of days below); payoff at expiry for option and stock legs, with maximum loss and gain (null when unlimited), breakevens and a defined-risk flag (the brief allows defined-risk structures only); liquidity guard (spread at most 10% of the mid, minimum open interest 100).
- Known answers: scipy 1.18 for ten price-and-greek cases within 1e-9 (including the textbook 10.4506 call), put-call parity, implied volatility recovered within 1e-7, and hand-checked spreads, an iron condor and naked positions. Mutation-checked.

## Consequences

- When the options plan is approved, the remaining Phase 6 work is data: daily ATM IV history, term structure and skew, implied-versus-realized earnings moves, unusual activity and put/call ratios, built on this module.
