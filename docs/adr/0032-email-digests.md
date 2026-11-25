# ADR 0032: Email copies of critical alerts and the alert digest

- Status: accepted
- Date: 2026-11-25
- Version: `digest-1`

## Context

The brief's third channel is "email through a transactional email API for digests and a copy of critical alerts", and its controls send alerts held by quiet hours or the daily push cap "into the next digest". Until now held alerts were stored as `digest` decisions and shown only on the Alerts page. Resend already sends the briefs (ADR 0015, SETUP step 9).

## Decision

- **Critical copies**: the alert writer marks `delivery.email = 'pending'` for critical alerts with a push decision; every system alert is marked the same way. Right after the Web Push dispatcher, the same workflow step sends each one as an email with the full stored card (the text the app shows), the time in ET and UTC, and a link to the card. A copy can be up to 24 hours late (it says how late); later it is recorded as expired.
- **Digest**: alerts the pipeline held back (quiet hours, the daily cap, digest priority, event risk) are marked `delivery.digest = 'pending'`. After the pre-market brief and the close recap, one digest email lists them oldest first with why each was held and its full card (20 in full, the rest named by headline, none dropped). Alerts held more than 48 hours are recorded as expired. A failed send returns the alerts to pending and fails the run.
- **Once only**: email and digest use the same conditional update as push (a field moves from pending to sending in one statement), so overlapping runs never send twice.
- **Not configured**: without `RESEND_API_KEY` and `BRIEF_EMAIL_TO`, pending items are recorded as not configured with the reason, so nothing floods in once the secrets are added.
- **Custom SMTP** (the checklist title): Supabase Auth's own emails (password reset) are a dashboard setting, not code. Marsad signs in with a password and an authenticator code and has sign-ups disabled, so it is optional; SETUP step 9 describes it.

## Consequences

- Digests arrive at most twice a trading day. Critical alerts bypass quiet hours and the cap, so they are pushed and copied, never held for a digest.
- Telegram (5.7) stays optional and separate.
