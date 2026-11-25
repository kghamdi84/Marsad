# ADR 0039: Password sign-in while Marsad is being tested

- Status: accepted (temporary, at Khaled's request on 2026-11-25)
- Date: 2026-11-25

## Context

Sign-in used an emailed link or code followed by an authenticator-app code, and every row-level security policy required an aal2 (second-factor) session. On 2026-11-25 Khaled could not sign in on his iPhone: Supabase's built-in email service refused more sign-in emails (its sending limit for projects without custom SMTP is very low). He asked for plain email and password sign-in while he is the only user and is still testing, with stronger sign-in restored when the platform is final.

## Decision

- **One switch, in two places.** `private.auth_policy.require_mfa` in the database (starts `false`) and `REQUIRE_MFA` in `apps/web/src/auth/policy.ts` (starts `false`). With the switch off, `private.is_mfa()` also accepts an `aal1` session of the `authenticated` role, and the app opens for any signed-in session.
- **What stays in force.** Every policy still requires `private.is_app_owner()` or `owner_id = auth.uid()`; sign-ups stay closed; the anon role has no grants; only Khaled's account is in `private.app_owners`. A token with no assurance level gets nothing. Signed-in users cannot read or change the switch.
- **Sign-in screen.** Email and password first (`signInWithPassword`); the emailed link stays as a fallback.
- **Setting the password without email.** The manual GitHub workflow "Set password" reads the `MARSAD_PASSWORD` secret and sets it on the one account whose email is in `BRIEF_EMAIL_TO`, through the Supabase admin API with the secret key. It refuses passwords under 10 characters, and refuses to act if no account or several accounts match. The password never appears in chat, email or logs.
- **Tests.** The row-level security tests run in strict mode by default and add a password-mode block (owner at aal1 reads, another account at aal1 reads nothing of the owner, no-level token and anon read nothing, the switch is unreadable); a test checks that the migration ships with the switch off. Mutating the switch logic or its default fails the tests.

## Restoring the second factor

Write a migration with `update private.auth_policy set require_mfa = true;`, set `REQUIRE_MFA = true`, and update the e2e test "in password mode an aal1 session opens the app". Khaled's authenticator factor stays enrolled, so nothing else changes.

## Consequences

- Anyone who learns the password can read Marsad's data (Khaled's holdings, trades and journal). Use a password used nowhere else, saved in iCloud Keychain.
- Integrity rule 17 (aal2 on every policy) is suspended until the switch is turned back on.
