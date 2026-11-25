# ADR 0015: Pre-market brief and close recap

- Status: accepted (starting rules; every change bumps the version)
- Date: 2026-11-25
- Version: `brief-1`

## Context

Phase 3 asks for a pre-market brief and a close recap "by email and push", and is done when "the brief arrives on my iPad". The brief's integrity rules: AI explains, code decides; numbers in AI text are checked against the payload; fall back to templates. There is no Anthropic API key yet, and no email or push channel is configured (each needs an account or key only Khaled can create).

## Decision

- **Content by templates** (`packages/core/src/briefs.ts`): market state (regime and recession filter, VIX and VIX over VIX3M, the Fear and Greed composite with its component count, universe breadth, capitulation watch if on), the day's tracked releases and FOMC (pre-market) or the next session's (recap), the watchlist's largest moves, estimated earnings in the next 7 days, a news topic well above its usual level, and a one-line system health status. Every number carries its date; a missing input reads "not computed" or "data unavailable". Title at most 60 characters and push body at most 140, as the brief requires for push.
- **Storage**: `briefs`, one row per kind and ET date, with the full input snapshot (so any brief can be rebuilt) and a delivery log.
- **Schedule**: pre-market about 60 minutes before the regular open (two weekday cron times, 12:30 and 13:30 UTC, cover summer and winter time; the job runs only inside a window of 30 to 89 minutes before the open, set by the repository variable `BRIEF_MINUTES_BEFORE_OPEN`, default 60); close recap at 22:50 UTC after the bars job. Holidays and weekends are skipped by the market calendar.
- **Delivery now**: email through Resend's HTTP API when the GitHub Actions secrets `RESEND_API_KEY` and `BRIEF_EMAIL_TO` exist (sender `onboarding@resend.dev` until a domain is verified, which Resend allows for the account owner's own address). Without them the brief is stored and shown on the Watch page, and the delivery log says "not-configured"; nothing fails silently. A brief already emailed that day is not emailed again; a failed send keeps the brief and fails the run.
- **Push**: Web Push to the Home Screen app needs a key pair, a service-worker handler and a subscription; it is built with the alert dispatcher in Phase 5, and the delivery log says so.
- **AI narrative**: added later on top of the template (claude-sonnet-5-5), with its numbers checked against the stored inputs, once the API key and cost caps exist.

## Consequences

- Until Khaled adds the two secrets, the brief is on the Watch page but not in his inbox.
- The brief reads only stored data, so a stale source shows in its health line rather than as a silent gap.
