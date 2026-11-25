# ADR 0031: Web Push to the Home Screen app

- Status: accepted
- Date: 2026-11-25
- Version: `push-1`

## Context

The brief's first delivery channel is Web Push to the installed PWA (push title up to 60 characters, body up to 140; tapping opens the full card). iPadOS and iOS deliver web push only to web apps added to the Home Screen. Until now, push alerts, system alerts (feed down and recovered) and briefs were stored and shown but not delivered. Khaled works on an iPad without a terminal, so setup has to happen in the app and in GitHub's web settings.

## Decision

- **Keys**: the Status page creates the VAPID key pair on Khaled's device with WebCrypto (P-256). The public key is saved in `user_settings.push_public_key` (not a secret); the private key is shown once for the GitHub Actions secret `VAPID_PRIVATE_KEY` and is never stored or sent by Marsad (browser test checks that no request carries it). The dispatcher derives the public key from the secret and refuses to send, failing the run, when it differs from the saved one.
- **Devices**: `push_subscriptions` is personal and limited to the app owner with MFA. The app and the database accept only endpoints on known push services (Apple, Google, Mozilla, Microsoft), so a stored row can never make the job post anywhere else.
- **Dispatcher** (`push-dispatch`): a step at the end of every workflow that can create an alert, a system alert or a brief (halts every 5 minutes on weekdays, health, bars, both briefs, the weekly review). No schedule of its own, so no extra Actions minutes. A manual workflow, Web Push, sends pending items or a test message.
- **Queue**: writers store `delivery.push = 'pending'` (alerts only for push decisions; others record `not sent (<decision>)`). The dispatcher claims each item with a conditional update (pending to sending), so two runs never send the same item, then records `sent to N of M devices`, `failed (...)` or why it was not sent.
- **Freshness**: an item is dropped instead of sent once it is older than its limit (critical and high alerts 2 hours, normal 6 hours, system alerts 2 hours, briefs 3 hours); a message sent 10 minutes or more after its event starts with "Sent N min late." Digest alerts are never pushed. Without the secret, keys or devices, pending items are recorded as not sent with the reason, so nothing floods in once setup is finished.
- **Devices that fail**: 404 or 410 from the push service disables the device; other failures are counted and shown on the Status page.
- **Library**: `web-push` 3.6.7 (aes128gcm, VAPID), pinned to the release in use since January 2024 rather than 4.0.0 (November 2026). Contact subject is the site address, so no personal address goes into requests.
- **Service worker**: `push-sw.js`, imported by the generated worker, shows only the title, body and tag, and opens only same-origin paths (alert cards carry `#alert-<id>`).

## Consequences

- Delivery latency is bounded by the workflow that creates the item plus the halts run every 5 minutes on weekdays; GitHub's scheduler delays (ADR 0008) still apply until Phase 5's poller.
- Replacing keys removes every device; each device turns notifications on again.
- Telegram and email copies of critical alerts remain separate items (5.7, 5.8).
