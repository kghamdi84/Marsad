# ADR 0005: Authentication and row-level security model

- Status: accepted
- Date: 2026-11-23

## Context

Marsad holds one person's trading data. The brief requires email one-time codes, TOTP multi-factor authentication, disabled public sign-ups, row-level security on every table keyed to the owner's user id, and only the publishable key in the browser.

## Decision

- Sign-in: `signInWithOtp` with `shouldCreateUser: false`, then `verifyOtp` with the 6-digit code. Public sign-ups are disabled in the project settings. The single user is created by hand in the dashboard.
- MFA: TOTP is mandatory. The app routes any session below AAL2 to enrollment (first time) or challenge.
- Defence in depth in the database: every policy for the `authenticated` role requires `auth.jwt() ->> 'aal' = 'aal2'`, through the helper `private.is_mfa()`. A stolen email code alone reads nothing.
- Two kinds of tables:
  - Personal tables (settings, watchlists, later journal and holdings) carry `owner_id uuid not null default auth.uid()` and policies `owner_id = auth.uid()` for select, insert, update and delete.
  - System tables written by jobs (`job_runs`, `source_status`, later market data) are written only by the secret key (`service_role`, which bypasses RLS) and readable only by users listed in `private.app_owners`. Owner-only, not "any signed-in user", so a second account created by mistake still sees nothing.
- `anon` gets no table privileges at all. Helper functions live in a non-exposed `private` schema.

- Revision 2026-11-23: without custom SMTP, Supabase sends its default "Magic link or OTP" template, which contains a sign-in link and no code, and templates cannot be edited. The client therefore uses the PKCE flow (`flowType: 'pkce'`, `detectSessionInUrl: true`, `emailRedirectTo` set to the site origin): the link completes only in the browser that requested it, and the one-time `code` is removed from the address bar afterwards. Code entry stays available for when a code template is possible. The TOTP requirement is unchanged: a link alone reaches only aal1, and every RLS policy requires aal2.

## Consequences

- An installed Home Screen PWA on iOS has storage separate from Safari, so an emailed link opens in Safari, not the PWA. Phase 5 adds custom SMTP and a code-only template so sign-in works inside the PWA.

- Tests in `supabase/tests/rls.test.ts` prove that a second user, an AAL1 session and the anon role cannot read the owner's rows.
- Adding the owner to `private.app_owners` is a one-time step after the user exists (Claude does it through the connector with Khaled's confirmation).
