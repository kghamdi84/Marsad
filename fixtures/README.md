# Fixtures

Recorded vendor responses (keys stripped) so tests run offline and repeatably.

- `massive/`: recorded on 2026-11-23 through the Massive MCP connector's `call_api`, which returns tables (CSV), not the raw REST envelope. The files hold the same fields in the REST JSON shape, and each has a `_recorded` block saying so. When `MASSIVE_API_KEY` is set (Phase 1 setup), re-record these from the live API so the envelope fields (`status`, `request_id`, `next_url`) are captured, then remove the caveat.
- `fred/`, `sec/`, and the 2026-11-16 to 2026-11-20 and 2026-11-18 `massive/aggs-SPY-*` files and `massive/not-entitled-403.json`: recorded from the live services on 2026-11-24 by the manual `record-fixtures` workflow, which prints trimmed bodies to the run log (never headers or keys). Each file wraps the body as `{ recordedAt, source, endpoint, status, body }`; `trimmedTo` says what was cut. To record more, add a call to `jobs/src/record-fixtures-main.ts`, run the workflow, and extract between the `FIXTURE_BEGIN` and `FIXTURE_END` markers. Logs of a public repository are public, so only public data may be recorded.
- `indicators/`: golden values for indicator tests. Inputs come from a seeded generator; expected outputs come from pandas, an independent implementation. Regenerate with `python3 fixtures/indicators/generate.py`.

## FRED graph downloads (recorded 2026-11-25)

`fred/fredgraph-<SERIES>.json` hold, in `body`, the public CSV downloads from `https://fred.stlouisfed.org/graph/fredgraph.csv?id=<SERIES>` (no key), kept from 2014-01-01 (the Sahm rule in full). They are the same values the FRED API returns, in the graph download's two-column format (`observation_date`, value; a blank or "." is a day with no value). Used by the regime and recession-filter tests to check known historical facts.

## Tauric company research (recorded 2026-11-28)

`tauric/research-<TICKER>-2026-11-28.json` hold the analyst, profile, thesis and calendar answers for NVDA and AAPL, and the `not_registered` answers for BBAI, recorded through the Tauric MCP connector (the same operations and schemas as the REST routes in `https://api.tauric.ai/openapi.json`). Each file is `{ recordedAt, source, ticker, via, note, parts: { <part>: { endpoint, status, body } } }`. No keys or headers are recorded. Used by the core validator tests and the research job tests (ADR 0047). Re-record from the REST API once `TAURIC_API_KEY` is set.
