# ADR 0018: Playbook library, rule lifecycle, backtest runner and replay

- Status: accepted
- Date: 2026-11-25

## Context

Phase 4 also asks for the seeded playbook library with evidence ratings and sources, the rule lifecycle (draft, backtested, shadow, live, demoted; live rules immutable, edits create versions), GitHub Actions runners and a replay mode.

## Decision

- **Playbooks** (`packages/core/src/playbooks.ts`): the brief's eleven, each with its rating, sources, horizon and summary. Three can be expressed in `rule-dsl-1` on daily bars today: the index trend filter (200-day average), the time-series part of ETF momentum (12-month return above zero) and the trend-template breakout (with an 8% stop). The other eight say exactly why not yet (ranking across assets, fundamentals, earnings surprises, Form 4 events, options, the capitulation watch, intraday bars). The brief's "leave out" list is shown with reasons.
- **Lifecycle** (`lifecycle.ts`): pure gates. Draft to backtested: at least 30 out-of-sample trades, positive expectancy after costs, and a 90% interval above zero. Shadow to live: at least 20 trading days and 15 signals. Live to demoted: the last 30 live signals average below the backtest's lower 90% bound. Allowed moves are fixed (a live rule is never edited back to draft; a new version starts as a draft).
- **Storage**: `rules` (one row per id and version, with the content hash; a trigger refuses any change to a version's id, number, hash or document, so only its status can move), `rule_events` (every status move with its reason and evidence), `backtest_runs` (parameters, costs, seed, trial count and the full report).
- **Runner**: `backtest-lab.yml` (Sundays 06:20 UTC and by hand) stores a new version only when a playbook's content hash changed, backtests on the playbook's tickers (walk-forward with an untouched holdout), stores the run, and moves a draft to backtested only when the gate passes. It never moves shadow or live rules; those moves come with Phase 5's shadow mode.
- **Replay** (`replay.ts`): re-runs a rule for one stored date using only bars up to it, and lists every comparison with the values it used.
- **Lab page** (header link next to Status): each playbook with its evidence, sources, rule JSON, status and newest run: out-of-sample trades, expectancy with its 90% interval, win rate, drawdown and Monte Carlo worst 5% only from 30 trades, otherwise "insufficient history"; costs; the gate's reason.

## Consequences

- With two years of free-plan bars, most playbooks will show "insufficient history" and stay drafts. That is the honest result; deeper history needs a paid plan (an open decision).
- Rule builder editing in the app (user rules) arrives with Phase 5's alert pipeline; the tables already accept `source = 'user'`.
