# Ideas for later phases

Captured during work so they are not built early.

- Phase 1: add `supabase/config.toml` when the Supabase CLI deploy workflow arrives, mirroring the dashboard auth settings (sign-ups off, TOTP on, OTP length 6).
- Phase 1: link `watchlist_items` to an instrument identity table (CIK, FIGI) instead of a bare ticker.
- Phase 1: a live RLS smoke test against the real project (two test users, run from GitHub Actions with the secret key), complementing the offline PGlite suite.
- Phase 5: custom SMTP sender for auth emails and digests (the built-in Supabase sender is rate limited), and a code-only (`{{ .Token }}`) Magic link template so sign-in works inside the installed PWA (ADR 0005 revision).
- Phase 8: code-split the web bundle per module once modules exist.
