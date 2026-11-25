# ADR 0022: Exit alerts, exposure and stress, and the rotation signal

- Status: accepted
- Date: 2026-11-25
- Versions: `exposure-1`, `rotation-1`; exit alerts run through `alerts-1`

## Context

Phase 7 asks for exit alerts per holding, exposure by sector with beta to SPY, concentration and correlation, stress scenarios (SPY down 5%, 10% and 20%; VIX up 10 points; a sector shock) labeled as approximations, ETF overlap, and a stock-to-ETF rotation signal that uses relative strength, trend and thesis status. Only end-of-day bars are available on the free Massive plan.

## Decision

- **Exit alerts** (`exit-alerts.ts`, job `alerts-exits` after each bars run): a rule (stop, target, trend break, time stop) fires only when it holds on the newest completed bar and did not hold on the bar before, so a holding below its stop raises one alert. Stops and trend breaks are high priority; targets and time stops normal. Each alert carries the case against selling, since an exit can be wrong too. A holding whose bars are missing or older than the last completed session is named and the run fails after storing the rest.
- **Freshness of end-of-day inputs**: the pipeline's per-priority limits (120 to 900 seconds) are for live data; a daily bar is never minutes old. An input may now carry its own `maxAgeSeconds`; exit alerts use 6 hours measured from when the bars job stored the bars, and the card says "delayed data". The halt alerts and the shared pipeline-and-store step now live in one helper (`alert-writer.ts`), since two jobs use it.
- **Exposure** (`exposure.ts`): beta to SPY, beta to the sector ETF and the daily return per VIX point are least-squares slopes of daily simple returns (VIX: point changes) over the last 252 common sessions, not reported under 60. Beta-weighted exposure counts a missing beta as 1 and names the ticker. Concentration is the largest weight, top-three weight, the Herfindahl index and its inverse. Scenarios are linear in those slopes and list their assumptions; a sector shock covers only holdings assigned to that sector. Correlations are over 126 sessions, flagged at 0.8.
- **Sector and thesis status** (migration `20261209000000`): each holding may name one of the 11 SPDR sector ETFs, and carries a thesis status (intact, weakening, broken; intact by default) that Khaled sets. Code never infers the thesis status.
- **Rotation** (`rotation.ts`): relative strength is (1 + stock return) / (1 + benchmark return) - 1 over 63, 126 and 252 common sessions against the sector ETF (else SPY) and SPY. The holding lags when it trails the benchmark on both 3 and 6 months and SPY on 6 months. Lagging with a weakening or broken thesis suggests the sector ETF or SPY; lagging in a downtrend with the thesis intact asks for a thesis review; otherwise the text says the exit rules still apply (holding is never presented as the default).
- **Bars**: the bars job now also stores the 11 sector ETFs and every open holding's ticker (about 30 calls at one every 12 seconds, well inside the 20-minute limit).
- **ETF overlap** needs ETF constituent data, which no current plan provides. It is labeled on the page as waiting for that data (docs/IDEAS.md).
- Known answers: numpy for betas, VIX sensitivity, correlation (with a missing session to test alignment) and relative strength within 1e-10; hand-checked weights, Herfindahl index and every scenario; a browser test where beta is exactly 2 by construction.

## Consequences

- The Journal page shows exposure, stress and rotation from stored bars in the browser; nothing is stored, so there is nothing to go stale beyond the bars themselves (which the health check already watches).
- Rotation alerts (pushed, not just shown) are left for when the thesis card (Phase 2) gives thesis status a history.
