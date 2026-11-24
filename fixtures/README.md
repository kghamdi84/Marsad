# Fixtures

Recorded vendor responses (keys stripped) so tests run offline and repeatably.

- `massive/`: recorded on 2026-11-23 through the Massive MCP connector's `call_api`, which returns tables (CSV), not the raw REST envelope. The files hold the same fields in the REST JSON shape, and each has a `_recorded` block saying so. When `MASSIVE_API_KEY` is set (Phase 1 setup), re-record these from the live API so the envelope fields (`status`, `request_id`, `next_url`) are captured, then remove the caveat.
- `indicators/`: golden values for indicator tests. Inputs come from a seeded generator; expected outputs come from pandas, an independent implementation. Regenerate with `python3 fixtures/indicators/generate.py`.
