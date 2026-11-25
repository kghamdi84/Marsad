# ADR 0011: Fear and Greed composite and capitulation watch

- Status: accepted (starting rules; every change bumps the version)
- Date: 2026-11-25
- Versions: `fear-greed-1`, `capitulation-1`

## Context

The brief asks for a Fear and Greed composite of seven components "following the published CNN methodology, computed in Marsad from sourced data", each mapped to 0 to 100 by its percentile over the trailing 504 trading days and averaged over the available components, showing which were available ("6 of 7"). It also asks for a capitulation watch that fires when VIX closes at or above 30, the share of the universe above its 50-day average is at or below 15%, the composite is at or below 15, and the recession filter is not high, and that produces a staged-entry plan for index ETFs (one third now, one third on a successful retest, one third on a reclaim of the 50-day average).

What Marsad has on the free plans (measured 2026-11-25): FRED S&P 500 (10 years), VIX (since 1990), ICE BofA high-yield and investment-grade spreads (FRED keeps 3 years, from 2023-11-27); Marsad universe breadth (2 years, ADR 0010); Massive daily bars (2 years) for SPY and IEF. No put/call ratio: Massive options data needs a paid options plan, and Cboe no longer publishes free daily put/call files.

## Decision

### Fear and Greed composite (`fear-greed-1`)

| Component            | Raw value                                                                                                    | Source                        | Direction     |
| -------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------- | ------------- |
| Market momentum      | S&P 500 close over its 125-session average, minus 1                                                          | FRED SP500                    | high is greed |
| Stock price strength | (new 252-session highs minus new lows) over the members with 252 sessions, when at least 500 members qualify | Marsad universe breadth       | high is greed |
| Breadth              | McClellan-style volume summation                                                                             | Marsad universe breadth       | high is greed |
| Put/call ratio       | 5-session average of the put/call ratio                                                                      | none on the current plans     | high is fear  |
| Junk bond demand     | high-yield minus investment-grade spread                                                                     | FRED BAMLH0A0HYM2, BAMLC0A0CM | high is fear  |
| Volatility           | VIX over its 50-session average, minus 1                                                                     | FRED VIXCLS                   | high is fear  |
| Safe-haven demand    | SPY 20-session price return minus IEF 20-session price return                                                | Massive daily bars            | high is greed |

- **Score**: the mid-rank percentile of the day's raw value among the component's own last 504 values (including the day): (values below + half the values equal) over the count, times 100. A component where high means fear scores 100 minus that. A component needs at least 252 values in its window; with fewer it is "short history" and left out.
- **Same day only**: a component counts on a day only if it has a value dated that day. Nothing is carried forward, so a late source lowers the count instead of showing an old value.
- **Composite**: the mean of the available scores, shown with how many there are ("6 of 7"). With fewer than 4 the composite is unavailable for that day.
- **Bands** (CNN's, on the composite rounded to a whole number): 0 to 24 extreme fear, 25 to 44 fear, 45 to 55 neutral, 56 to 75 greed, 76 to 100 extreme greed.
- Prices are price returns (dividends left out), the same for SPY and IEF; the small yield difference shifts every value alike, which a percentile mostly absorbs.

### Capitulation watch (`capitulation-1`)

Four conditions on each day's close: VIX at or above 30; at most 15% of the Marsad universe above its 50-day average (with at least 500 members that have 50 sessions); composite at or below 15; recession filter not high (low or elevated). The state is **on** when all four hold, **off** when any condition with data fails, and **unavailable** when none fails but at least one has no data. Unavailable is shown as such, never as off.

An episode starts on an "on" day after a day that was not on. Its staged-entry plan, for index ETFs, is a set of conditions, not orders (Khaled decides and places every order):

1. One third at the trigger close.
2. One third on a successful retest: the low of the selloff is the lowest SPY close in the 10 sessions up to the trigger, lowered by any later lower close. A retest is the first session at least 5 sessions after that low whose low comes within 2% of it and whose close is at or above it.
3. One third on the first SPY close above its 50-day average after the trigger.

- **Pause**: if the recession filter turns high after the trigger, the plan pauses and the remaining thirds are not due (the brief's recession gate).
- **Review**: a SPY close more than 10% below the trigger close is flagged for review (the bear case is playing out).
- **Expiry**: the plan lasts 126 sessions after the trigger.
- **Bear case** (shown with the plan): in 2008 the VIX stayed above 35 for weeks while the decline continued, and in 2022 the market made new lows months after its March volatility spike; staging limits the damage if this is one of those episodes.
- **History**: the full condition needs breadth and the composite, which start in late 2025, so its own event study has too few cases. The page shows Marsad's event study for the longer proxy "VIX close at or above 30 with the recession filter not high" (S&P 500 since 2016, ADR 0009 method), with n, and "insufficient history" under 30 episodes.
- The quality-at-discount screen it should refresh does not exist yet (Phase 4 or later); the page says so.

## Consequences

- Today the composite has at most 6 of 7 components; put/call returns with an options plan (Phase 5 asks for put/call ratios anyway).
- The composite starts around the turn of 2026: before that, fewer than 4 components have 252 values (safe haven and breadth need 252 values on top of 2 years of bars and breadth). Stock price strength needs 252 values of a 252-session measure, so it joins about two years after breadth starts (around December 2026); until then the reading is at most 5 of 7. The junk-bond component is limited by FRED's 3-year window.
- Every day stores each component's raw value, score and window size, so any day can be recomputed and compared.

## Addendum (2026-11-25): the alert when the watch turns on

- The sentiment job raises one regime alert (high priority, rule `capitulation-watch`, live) for a trigger at most 4 calendar days old while the newest day with every input is still on. The event key is the trigger date, so reruns never store it twice; an older trigger found by a backfill is history, not an alert.
- The card follows the brief's example 3: each condition with its value and threshold, Marsad's proxy event study at 63 sessions with n, median and quartiles (under 30 episodes it says the history is insufficient and gives no rate), the staged plan as conditions with SPY levels, and the bear case. The long-horizon risk row counts proxy episodes with a lower S&P 500 close 63 sessions later.
- The newest day is often unavailable for a few hours because FRED publishes the VIX close the next morning; the job judges the newest complete day.
- Delivery: Web Push (ADR 0031), subject to quiet hours like every high-priority alert.
