# Fixtures

Recorded vendor responses (keys stripped) so tests run offline and repeatably.

- `massive/`: recorded on 2026-11-23 through the Massive MCP connector's `call_api`, which returns tables (CSV), not the raw REST envelope. The files hold the same fields in the REST JSON shape, and each has a `_recorded` block saying so. When `MASSIVE_API_KEY` is set (Phase 1 setup), re-record these from the live API so the envelope fields (`status`, `request_id`, `next_url`) are captured, then remove the caveat.
- `fred/`, `sec/`, and the 2026-11-16 to 2026-11-20 and 2026-11-18 `massive/aggs-SPY-*` files and `massive/not-entitled-403.json`: recorded from the live services on 2026-11-24 by the manual `record-fixtures` workflow, which prints trimmed bodies to the run log (never headers or keys). Each file wraps the body as `{ recordedAt, source, endpoint, status, body }`; `trimmedTo` says what was cut. To record more, add a call to `jobs/src/record-fixtures-main.ts`, run the workflow, and extract between the `FIXTURE_BEGIN` and `FIXTURE_END` markers. Logs of a public repository are public, so only public data may be recorded.
- `indicators/`: golden values for indicator tests. Inputs come from a seeded generator; expected outputs come from pandas, an independent implementation. Regenerate with `python3 fixtures/indicators/generate.py`.
