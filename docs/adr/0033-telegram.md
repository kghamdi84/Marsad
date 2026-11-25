# ADR 0033: Telegram as the optional second channel

- Status: accepted
- Date: 2026-11-25
- Version: `telegram-1`

## Context

The brief lists a Telegram bot as optional and recommended as a second channel. Web Push on iPadOS depends on the Home Screen app, its permission and Apple's push service; when any of those fails, a second channel keeps an alert from turning into silence.

## Decision

- **What it carries**: exactly what push carries (push-decision alerts, system alerts, briefs), with the same text, the same freshness limits and late labels (`planPush`), plus a link to the card. Writers queue `delivery.telegram = 'pending'` next to push; each channel has its own field and its own once-only claim, so one failing never blocks the other.
- **Where it runs**: in the dispatcher step after Web Push (no new schedule). The manual Web Push workflow's test option also sends a Telegram test message when configured; a test fails only if no channel works.
- **Secrets**: `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` as GitHub Actions secrets. Without both, items are recorded as not configured. Errors name Telegram's status and description, never the request address (it contains the token); a test checks this.
- **Bot**: send-only. Marsad does not read messages sent to the bot or act on them; the bot only writes to Khaled's own chat.
- Briefs stored before this change are recorded as not sent on Telegram rather than sent late.

## Consequences

- Each alert can reach Khaled twice (push and Telegram) by design; Telegram's own notification settings control its sound.
