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
- Revision 2026-11-25: PKCE failed in real use. On an iPhone the mail app opens the link in Safari or its own viewer, and a Home Screen app has separate storage, so the browser that opened the link rarely held the PKCE verifier and sign-in failed. The client now uses the implicit flow (`flowType: 'implicit'`): the link signs in whichever browser opens it, and the tokens are removed from the address bar at once. For signing in somewhere else (the Home Screen app), the sign-in field also accepts the whole link copied from the email: the app takes its one-time `token` (the `TokenHash`, per Supabase's email template docs) and calls `verifyOtp({ token_hash, type })`, which works in any browser. Only `https://<project>.supabase.co/auth/v1/verify` links of type `magiclink` or `email` are accepted. A failed link's reason (for example, expired) is shown on the sign-in screen. Trade-off: anyone holding an unused link can sign in with it, as with any magic link; it is single-use and short-lived, and it only reaches aal1, so the TOTP requirement still protects every row.
