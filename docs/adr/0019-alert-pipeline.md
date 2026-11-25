# ADR 0019: Alert pipeline, card, halt alerts and feedback

- Status: accepted (starting rules; every change bumps the version)
- Date: 2026-11-25
- Version: `alerts-1`

## Context

Phase 5 asks for live alerts. Its prerequisites, the Massive Stocks plan and Supabase Pro, cost money and are Khaled's decision, so live ingestion, the tick fan-out and push delivery wait. The parts that need neither can be built and tested now: the signal-to-alert pipeline, the card, shadow logging, feedback, latency, and halt alerts from the free Nasdaq halts feed that Marsad already reads every 5 minutes in market hours.

## Decision

- **Pipeline** (`packages/core/src/alerts.ts`), in order: data freshness by priority (critical 2 minutes, high 5, normal 15, digest a day); rule status (shadow rules are logged, never delivered); liquidity for setup, opportunity and rotation alerts (USD 5 million last session); the chase guard (price past the signal by more than the rule's limit); event risk (a setup within 30 minutes of a high-impact release goes to the digest); per-kind toggles (system alerts cannot be turned off); per-ticker snooze; dedupe on kind, ticker, rule and local day, or on the event id for event alerts, and a 4-hour cooldown for non-event alerts; quiet hours 23:00 to 07:00 in Asia/Riyadh and a daily cap of 8 pushes, both sending to the digest; critical alerts bypass quiet hours and the cap. Every step's outcome is stored as a reason.
- **Card** in the brief's order: header, trigger, plan, risk by horizon (loss rate with n and a 90% Wilson interval, "insufficient history" under 30, "n/a" where the horizon does not apply), context, news, checklist, bear case, sources and freshness. Push title at most 60 characters, body at most 140.
- **Halt alerts**: a halt or a published resumption in a watched ticker (the starting list and any saved watchlist) is an event alert; a news-related halt is critical (the exchange notice is a tier-1 source). Freshness is the age of the feed read, not the age of the halt. A step in the halts workflow runs the pipeline and stores each event once.
- **Storage**: `alerts` keeps every judged signal (push, digest, shadow, suppress) with its input snapshot, rule version, dedupe key, reasons, card, push text, source time and end-to-end latency, and the delivery log (`not-configured` until Web Push exists). `alert_feedback` is personal (the owner writes it with MFA): useful, noise or acted on, one per alert.
- **Alerts page**: the newest alerts as cards with decision, reasons, latency and feedback buttons; suppressed signals on request.

## Consequences

- Until Web Push, Telegram or email is set up, alerts are stored and shown in the app but not delivered; the card says so.
- Rule-based alerts (setups, exits) need live or intraday data and live rules; they arrive after the Phase 5 prerequisites.
