# ADR 0009: Regime label, recession filter and event studies (methodology and data)

- Status: accepted (starting thresholds; tunable, every change bumps the rule version)
- Date: 2026-11-25
- Rule versions: `regime-1` (label), `recession-1` (filter), `event-study-1` (statistics)

## Context

The brief (module "regime") asks for a regime label from documented rules, a recession filter with transparent starting thresholds, and, for each label, the historical forward-return distribution from Marsad's own event study (n, median, quartiles). Phase 3 is done when the label is reproducible from stored inputs and every panel shows its source and as-of time.

What the free data allows, measured on 2026-11-25 (first observation on FRED):

| Input | Series | First date | Frequency |
| --- | --- | --- | --- |
| S&P 500 close | `SP500` | 2016-11-25 (FRED keeps 10 years) | daily |
| VIX close | `VIXCLS` | 1990-01-02 | daily |
| VIX 3-month (VIX3M) | `VXVCLS` | 2007-12-04 | daily |
| 10-year minus 3-month | `T10Y3M` | 1982-01-04 | daily |
| High-yield option-adjusted spread | `BAMLH0A0HYM2` | 2023-11-27 (licensed series, FRED keeps 3 years) | daily |
| Investment-grade spread | `BAMLC0A0CM` | 2023-11-27 | daily |
| Financial conditions | `NFCI` | 1971-01-08 | weekly (Friday) |
| Initial jobless claims | `ICSA` | 1967-01-07 | weekly (Saturday) |
| Sahm rule, real time | `SAHMREALTIME` | 1959-12-01 | monthly |
| Economic policy uncertainty | `USEPUINDXD` | 1985-01-01 | daily |
| Geopolitical risk | GPR daily file | 1985 | daily |

The Massive free plan gives 2 years of daily bars. The Indices plans (VIX itself) are not needed: VIX and VIX3M come from FRED.

## Decision

### Point in time

A value is used only from the day it was published, not the day it describes:

- Daily market closes (S&P 500, VIX, VIX3M, yields, spreads, EPU): available at that day's close.
- Jobless claims (week ending Saturday): published the following Thursday, so available 5 days after the week ends.
- NFCI (week ending Friday): published the following Wednesday, so available 5 days later.
- Sahm rule (month M): published with the Employment Situation report, usually on the first Friday of M+1; Marsad uses it from the 10th day of M+1, a conservative lag that never runs ahead of the release.
- `SAHMREALTIME` is the real-time (unrevised) series, so it is not revised history. Claims and NFCI are revised slightly afterwards; their first-release values are not stored (a known limit).

### Recession filter (`recession-1`)

Five signals, each with its value, threshold, source and as-of date:

1. Sahm rule at or above 0.50 (Sahm, 2019).
2. Yield curve: 10-year minus 3-month below zero now, or on at least 20 sessions in the last 378 sessions (about 18 months). The term spread predicts recessions 2 to 6 quarters ahead (Estrella and Mishkin, 1998), so a recent inversion still counts.
3. Credit: high-yield spread at or above 6.0 percentage points, or up at least 1.5 points over 63 sessions.
4. Jobless claims: the 4-week average at least 20% above its lowest 4-week average of the previous 52 weeks.
5. Financial conditions: NFCI above zero (tighter than average).

Level: **high** when the Sahm rule triggers or at least three signals trigger; **elevated** when one or two trigger; **low** when none do. A signal without data is "unavailable", the output says how many signals were available, and with fewer than three available the level is "unavailable". Before 2023-11-27 the credit signal is unavailable, so historical filter values use four signals and say so.

### Regime label (`regime-1`)

From the S&P 500 close (S), its 50- and 200-session averages, the 200-session average 20 sessions earlier, the drawdown from the 252-session high, VIX, and VIX over VIX3M. The first rule that matches wins:

1. **Stress**: VIX at or above 30, or VIX at or above VIX3M (backwardation) while S is below its 50-session average.
2. **Bear**: S below its 200-session average and that average lower than 20 sessions ago.
3. **Recovery**: a stress or bear label in the previous 63 sessions, S above its 50-session average, and S still at least 5% below its 252-session high. (Without the last condition, the first draft labelled 30% of all days since 2017 "recovery", including months at new highs with VIX near 15 after a brief spike.)
4. **Bull calm**: S above both averages, drawdown smaller than 5%, VIX below 20.
5. **Bull correction**: everything else (an uptrend with a pullback or higher volatility).

With fewer than 252 sessions of S&P 500 history or no VIX for the day, the label is "insufficient data". VIX3M missing makes the backwardation part of rule 1 unavailable (stated with the label). The capitulation watch and the Zweig breadth thrust (Phase 3, breadth batch) are shown alongside the label; they do not change it in `regime-1`.

Every computed day is stored with its inputs and rule version (`regime_daily`), so any label can be recomputed from what is stored and compared.

### Event studies (`event-study-1`)

For each label and for conditions such as VIX at or above 30: an episode starts on the first day the condition holds after a day it did not, and a new episode cannot start within 63 sessions of the previous start, so 63-session windows do not overlap and n counts independent episodes. Forward returns of the S&P 500 close at 21, 63 and 126 sessions. Statistics: n, median, 25th and 75th percentiles (linear interpolation between order statistics, the same as NumPy's default), min and max. A baseline over non-overlapping windows of all days is shown beside each, as the benchmark.

With fewer than 30 episodes the distribution is not shown; the page says "insufficient history" with n (integrity rule 10).

## Consequences

- With the S&P 500 back to 2016-11 only, most labels will have fewer than 30 independent 63-session episodes, so the page will mostly show "insufficient history". The label itself, the recession filter and every panel work on the free data.
- Ways to deepen the history, for Khaled to decide (none is taken by this ADR):
  1. Massive Stocks Advanced (USD 199 a month, 20+ years of SPY history; Phase 5 needs a Stocks plan anyway). Confirm on massive.com/pricing first.
  2. The Nasdaq Composite on FRED (`NASDAQCOM`, daily since 1971, free) as a labelled proxy for the event studies only. It is tech-heavy, so results would describe the Nasdaq, not the S&P 500.
- Thresholds are starting points from the brief and the cited papers, not fitted to data. Tuning them needs the trial counting and out-of-sample rules of Phase 4.
