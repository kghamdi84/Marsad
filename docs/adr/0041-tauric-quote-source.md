# ADR 0041: Tauric as a second quote source, chosen per person

- Status: accepted
- Date: 2026-11-26

## Context

Khaled asked to keep Massive and add Tauric (Tauric Research, `api.tauric.ai`) with a single-choice switch for where "live prices" come from. Before building, three independent reviews (architecture, data integrity, vendor terms) were asked whether it is possible and sound. All three answered "go with changes". The facts they worked from, measured on 2026-11-26 (US Thanksgiving, market closed):

- Marsad has no live price feed today. Massive is on its free end-of-day plan, and the 15-second `tick` from ADR 0003 was never built. The Watch page shows the last completed session (ADR 0014).
- Tauric `POST /v1/quotes` (schema in the public `https://api.tauric.ai/openapi.json`) returned the 2026-11-25 closes of AAPL, NVDA and SPY, equal to Massive's to the cent. Its session volume was 2.3% (AAPL) and 1.9% (NVDA) below Massive's, and opens differ by a few cents.
- Tauric does not publish its delay for US stocks. Its stock bid and ask are always null. Its 15-minute and hourly bars are added only at the end of each session.
- Tauric's own freshness fields mislead: an FX quote about 30 minutes old read `price_age_seconds: 5` and `stale: false` (the age at its last refresh, not at reading).
- Terms (tauric.ai/terms, effective 2026-11-11): "You may use and display data and content from the Services in your work and applications", with no resale and no sharing of keys. There is no SLA, and the service may change or stop at any time. Keys use `Authorization: Bearer` and are created at tauric.ai/settings/api-keys. The Standard tier gives 3,000 data credits a day (one per successful request) and 60 requests a minute; no price is published for it.
- `packages/core/src/provenance.ts` labelled a value of `unknown` plan tier "Live". Any source added honestly as `unknown` would have been called live.

## Decision

1. **Display only.** The switch changes only the latest price shown on the Watch list and the company page header. Stored daily bars, indicators, breadth, backtests, rules, alerts and replay keep Massive as their one source of record and never read the setting. No rule depends on Tauric, so its silence pauses nothing.
2. **Per person, in `user_settings.quote_source`** (`massive` by default, or `tauric`). The schema guards allow signed-in users to write only personal tables, and a display choice is personal; friends (ADR 0040) choose for themselves. The Status page shows it as two radio buttons that save when tapped.
3. **Never "Live" until proven.** The `unknown` tier now reads "Delay not confirmed" with the delayed tier's allowance (90 s plus 15 minutes in the regular session), then "Stale". A known-answer test fixes this. Freshness is computed from the vendor's `price_time` and Marsad's clock; Tauric's own `stale` and `price_age_seconds` are ignored.
4. **Both sources keep running.** A GitHub Actions job (`tauric-quotes.yml`, every 5 minutes, 13:00 to 21:59 UTC on weekdays) polls one batch of up to 50 tickers (starting list first, then saved watchlists) during the regular session and for 15 minutes after the close, whatever anyone selected. It writes `public.price_quotes` (latest per ticker, member-readable, written only with the secret key) and the `tauric` row of `source_status`. Outside that window it records a skipped run and spends no credit. At most about 110 credits a day.
5. **Second-source check.** `tauric-reconcile.yml` (23:20 UTC weekdays, after the Massive bars job) compares Tauric's price for the finished session with Massive's stored daily bar for the starting tickers Tauric covers: close within 0.05% or 1 cent (whichever is larger). A close outside that, a covered ticker with no quote, a missing bar, different session dates, or nothing compared fails the run, which the Status page and the health job report.
   - Revision 2026-11-26, after the first live run with Khaled's key: Tauric does not carry MARA, HIMS, RGTI or BBAI (`not_registered`), and its volume counts fewer venues (DIA 10.3% lower, SPY 1.0%, NVDA 1.9%, AAPL 2.3%, every close equal). Khaled chose "report, don't fail": tickers Tauric does not carry are listed in the run details and shown as "Not covered by Tauric", and the volume gap is recorded per ticker, never failed. Marsad shows no Tauric volume.
6. **No secret, no failure.** Both workflows end at their first step until the `TAURIC_API_KEY` repository secret exists, so nothing fails or emails while the key is missing.

## Consequences

- With Massive selected, nothing changes on screen (there is no intraday Massive price on the free plan). With Tauric selected, a "Latest (Tauric)" column and a line under the company price show its price, change and age in words.
- Tauric stays labelled "Delay not confirmed" until a live US session is measured against an outside reference; then this ADR is revised with the measured delay and the tier.
- The fixture was recorded through the Tauric MCP connector (same operation and schema as the REST call). Re-record from the REST API once the key is set.
- GitHub's scheduler is best-effort, and in this repository it drops most runs (ADR 0008): on 2026-11-25 and 26 the heartbeat, set for every 15 minutes, fired 9 times in two days, hours apart. Until ADR 0008's trigger from Supabase Cron is accepted, Tauric quotes will arrive far less often than every 5 minutes, and the Tauric health limit (30 minutes) will report the gaps. The labels show each quote's real age, so a late quote reads "Stale", never fresh.
- Instruments are matched by ticker (`security:{TICKER}`); Tauric's quote does not carry CIK or FIGI. The price is display only, so no identity-sensitive calculation uses it.
- Vendor risk: no SLA and stop-at-will terms. Massive remains the source of record, so losing Tauric costs one column.
- Not built (by the reviews' advice): a system-wide switch, an audit log of changes, Tauric as a source for any rule or alert, and any "live" label.
