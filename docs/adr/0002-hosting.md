# ADR 0002: Hosting on Netlify (static) and Supabase

- Status: accepted
- Date: 2026-11-23

## Context

The brief fixes the providers: Netlify for the web app, Supabase for Postgres, Auth, Realtime, Cron and Edge Functions, GitHub Actions for CI and heavy batch work. Billing and ownership must stay with Khaled personally, separate from any work organization.

## Decision

- The web app is a static single-page app on a `*.netlify.app` address. No Netlify Functions are used, so Netlify's 30-second and 15-minute function limits do not apply.
- All server work runs in Supabase (Edge Functions, pg_cron) or GitHub Actions.
- Only a personal Supabase organization and a personal Netlify team are used. On 2026-11-23 the Supabase connector could see only the "Gulf Insulation Group" organization and the Netlify connector only a team named "GIG". Neither is used until Khaled confirms in writing which resources are personal (see docs/SETUP.md).
- Start on Supabase Free. Upgrade to Pro before live alerts (Phase 5) because Free pauses after a week of low activity and has no backups.
- Security headers (CSP, `X-Robots-Tag: noindex`, Referrer-Policy, Permissions-Policy) are served from `apps/web/public/_headers`. SPA routing uses `_redirects`.

## Consequences

- The browser holds only the publishable Supabase key; row-level security is the security boundary.
- A paused Free project would make Marsad look empty. The status page and the morning brief (Phase 3) must report it as unavailable, never as calm.
