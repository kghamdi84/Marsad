# Marsad setup (for Khaled, on iPad)

These are the steps only you can do: creating accounts, approving costs and adding secrets. Each step says what to tap. Do them in order. When a step says **Tell Claude**, paste the listed values into the Claude Code session.

Never paste a secret key, password or token into the chat. Steps that involve secrets say where to put them instead.

## Accounts Marsad uses

| Service               | Account                                                                                           | Status                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Supabase organization | **Personal Projects** (Free), personal, may host other personal projects                          | Created 2026-11-23                                                                   |
| Supabase project      | "kghamdi84's Project", ref `hwdwivilqdydmxhycapy`, Tokyo (`ap-northeast-1`), Nano                 | Created 2026-11-23; connector cannot see it yet                                      |
| Supabase GitHub link  | Linked to `kghamdi84/Marsad` when the project was created                                         | Settings to confirm (step 1b)                                                        |
| Netlify team          | **GIG** (`khaled-alghamdi-84`), confirmed personal by Khaled 2026-11-23                           | Confirmed                                                                            |
| Netlify site          | `marsad-k84` at `https://marsad-k84.netlify.app` (site id `c8eb3a9d-8c02-4bba-818e-1970923ca7ea`) | Created and linked to GitHub `main` 2026-11-23; first real deploy after PR #1 merges |
| GitHub                | This private repository                                                                           | Exists                                                                               |

Project URL: `https://hwdwivilqdydmxhycapy.supabase.co`. This address and the publishable key are public by design; the secret key and database password are not.

Never use the **Gulf Insulation Group** Supabase organization for Marsad. It is a work organization.

## Step 1. Personal Supabase organization and project (done)

You created the **Personal Projects** organization and the project on 2026-11-23. Two follow-ups:

1. Reconnect the Supabase connector so Claude can see the new organization. In the Claude app, open **Settings**, then **Connectors**, then **Supabase**, tap **Disconnect**, then **Connect**. On Supabase's approval screen, select **Personal Projects**. (On 2026-11-23 after creation, the connector still saw only Gulf Insulation Group.)
2. Optional: rename the project to `marsad` so it stands out among your future personal projects: **Project Settings**, **General**, **Project name**, **Save**. Nothing in Marsad depends on the name; the ref `hwdwivilqdydmxhycapy` never changes.

About the region: the project is in Tokyo. That is fine for Marsad. Polling and alerts tolerate the extra round trip, and moving regions means recreating the project, so keep it.

## Step 1b. Supabase GitHub integration (deploys database changes)

Because the project is linked to this repository, Supabase can apply database migrations itself whenever a change lands on `main`. Marsad uses this as its deployment path (ADR 0004), so Claude never needs your database password for it.

1. In the project, tap **Project Settings** (gear icon at the bottom left), then **Integrations**.
2. Under **GitHub Integration**, check these settings and tap **Save** or **Update** if you change anything:
   - Repository: `kghamdi84/Marsad`
   - Working directory: `.` (a single dot; the `supabase` folder sits at the top of the repository)
   - Production branch: `main`
   - **Deploy to production**: on (it was found off on 2026-11-23, which is why the first migration did not run). Then set **Production branch name** to `main` and save.
   - **Automatic branching**: off (preview branches need the Pro plan)
3. **Tell Claude:** "GitHub integration checked."

The first database migration is applied when pull request #1 is merged into `main`. Claude then verifies it through the connector.

## Step 2. Configure Supabase Auth (Claude cannot do this through the connector)

Status 2026-11-23: the live project still reports sign-ups as **on** (`disable_signup: false`). Do item 1 below first.

In the Supabase project (`hwdwivilqdydmxhycapy`):

1. Tap **Authentication** in the left menu, then **Sign In / Providers** (on some layouts: **Providers**).
   - Under **User Signups**, turn **Allow new users to sign up** **off**. This is what keeps Marsad single-user.
   - Under **Email**, keep **Email** enabled. Turn **Confirm email** on.
   - Set **Email OTP Length** to `6` and **Email OTP Expiration** to `600` seconds if those fields are shown.
2. Tap **Authentication**, then **Multi-Factor** (or **MFA**). Set **TOTP (App Authenticator)** to **Enabled**.
3. Email template: no change needed. On the Free plan without custom SMTP, Supabase does not allow editing templates, and its default "Magic link or OTP" email contains a **Sign in** link. Marsad accepts that link: tap **Sign in** in the email and you are signed in wherever it opens; or, to sign in in the Home Screen app, touch and hold **Sign in**, choose **Copy Link**, and paste it into Marsad's sign-in field. Do **not** create a "Send Email hook" under **Auth Hooks**: it would replace Supabase's emails and no sign-in email would arrive.

4. Tap **Authentication**, then **Users**, then **Add user**, then **Create new user**. Email: your personal email. Turn **Auto Confirm User** on. Leave the password empty if allowed; otherwise use a long random one you discard. Tap **Create user**.
5. Tap **Authentication**, then **URL Configuration**. Set **Site URL** to `https://marsad-k84.netlify.app`.
6. **Tell Claude:** "Auth configured."

Note: the built-in Supabase email sender is rate limited (a few emails per hour) and meant for testing. It is enough for one person signing in. A custom SMTP sender is set up in Phase 5 along with email digests.

## Step 2b. Set or change your password (no email needed)

Marsad signs in with email and password while it is being tested (ADR 0039). The password is set by a GitHub workflow, so no email is sent and the password never appears in chat or logs.

1. In GitHub, open the repository, tap **Settings**, **Secrets and variables**, **Actions**, **New repository secret**. Name `MARSAD_PASSWORD`; value: a password of at least 10 characters that you use nowhere else. Tap **Add secret**. (To change it later, tap the secret, then **Update secret**.)
2. Tap **Actions**, choose **Set password**, tap **Run workflow**, then **Run workflow** again. It finishes in about a minute with "password set".
3. In Marsad, sign in with your email and that password, and let iCloud Keychain save it.

## Step 2c. Let friends create accounts (ADR 0040)

In Supabase (organization **Personal Projects**, project `hwdwivilqdydmxhycapy`): tap **Authentication**, then **Sign In / Providers**. Turn **Allow new users to sign up** on, and turn **Confirm email** off (the built-in email sender allows only a few emails an hour). Tap **Save**. Friends then tap **Create an account** on Marsad's sign-in screen.

## Step 3. Link the Netlify site to GitHub (done)

Claude created the site `marsad-k84` in team **GIG** and set `VITE_SUPABASE_URL`. Khaled linked it to `kghamdi84/Marsad`, branch `main`, on 2026-11-23, with build command `pnpm --filter @marsad/web build` and publish directory `apps/web/dist` (the same values as `netlify.toml`).

Tap path in Netlify's current layout, for reference: **Projects**, **marsad-k84**, **Deploys** (in the project's own sidebar), **Deploy settings**, **Link repository**.

The first deploy (`main@f70e132`, README only) failed because `main` had no app yet. That is expected; merging pull request #1 triggers the first real build.

## Step 4. Netlify environment variables (browser-safe values only)

Status: `VITE_SUPABASE_URL` set by Claude on 2026-11-23. `VITE_SUPABASE_PUBLISHABLE_KEY` is not set yet: the next Claude session reads it through the Supabase connector and sets it, or you can add it yourself in Netlify under **Project configuration**, **Environment variables**, **Add a variable**.

Find these in Supabase: **Project Settings**, then **API Keys** and **Data API**.

| Netlify variable                | Value                                                        | Secret?                                   |
| ------------------------------- | ------------------------------------------------------------ | ----------------------------------------- |
| `VITE_SUPABASE_URL`             | Project URL, like `https://hwdwivilqdydmxhycapy.supabase.co` | No. It is public by design.               |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | The **publishable** key (starts with `sb_publishable_`)      | No. Row-level security protects the data. |

Never put the **secret** key (starts with `sb_secret_`) or the old `service_role` key into Netlify. Claude can also read these two public values through the Supabase connector and set them for you if you prefer.

## Step 5. GitHub Actions secrets

The first scheduled job (the Geopolitical Risk Index, which uses only public data) needs just two secrets. Add them first, run the job, and watch the Status page change.

**Do this now (2 secrets):**

1. In GitHub, open the repository, tap **Settings**, then **Secrets and variables**, then **Actions**, then **New repository secret**.
2. Add `SUPABASE_URL` with the value `https://hwdwivilqdydmxhycapy.supabase.co`.
3. Add `SUPABASE_SECRET_KEY`. Find it in Supabase: **Project Settings**, **API Keys**, the **Secret keys** section (it starts with `sb_secret_`). Paste it only into GitHub's secret box, never into chat. This key bypasses the database security rules, which is why it lives only in GitHub and Supabase.
4. In GitHub, tap **Actions**, then **GPR daily** in the left list, then **Run workflow**, then **Run workflow** again. It finishes in about a minute.
5. In Marsad, tap **Status**. The **Geopolitical Risk Index** row should read "OK, last message ... ago", with plan tier `end-of-day`, a latency, and the note "Latest value" plus today's date. **Recent job runs** should list `gpr-daily` with 15,000 or more rows.

**Later in Phase 1 (not needed yet):**

| Secret                  | Where to find it                                                 | Used for                                                                                                                    |
| ----------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `MASSIVE_API_KEY`       | massive.com dashboard, **API Keys**                              | Market data adapters, holiday calendar                                                                                      |
| `FRED_API_KEY`          | `https://fredaccount.stlouisfed.org/apikeys` (free)              | Macro series, VIX and yield cross-checks                                                                                    |
| `SEC_USER_AGENT`        | Text you choose, like `Marsad research your-email@example.com`   | SEC EDGAR fair-access contact (the SEC requires a real contact; Claude never fills this in)                                 |
| `SUPABASE_ACCESS_TOKEN` | Supabase: **Account**, **Access Tokens**, **Generate new token** | Only when the first Edge Function is deployed (Phase 5). Not needed now. The database is deployed by the GitHub integration |
| `ANTHROPIC_API_KEY`     | console.anthropic.com, **API Keys**                              | AI summaries, thesis drafts and weekly review prose (ADR 0007). GitHub repository secret; capped at USD 1 a day, 10 a month |
| `TAURIC_API_KEY`        | tauric.ai, **Settings**, **API keys** (choose an expiry)         | Optional second quote source (ADR 0041). GitHub repository secret only; the Tauric workflows wait for it                    |
| `OPENFIGI_API_KEY`      | openfigi.com, sign in, **API Key**                               | Optional. ETF holdings match tickers by CUSIP (ADR 0038 addendum); faster with it, works without it. GitHub secret only     |

## Step 6. Supabase Edge Function secrets (Phase 1, not needed yet)

In Supabase: **Edge Functions**, then **Secrets**, then **Add new secret**. Same names as the data keys above (`MASSIVE_API_KEY`, `FRED_API_KEY`, `SEC_USER_AGENT`, later `ANTHROPIC_API_KEY`). Claude can also add these through the connector if you paste them into the secure form it shows, never into chat.

## Step 7. Optional: Telegram as a second alert channel (free)

Alerts that reach the iPad as notifications can also arrive in Telegram, so one broken channel never means silence.

1. In Telegram, open a chat with **@BotFather** (the blue check mark shows it is Telegram's own), send `/newbot`, choose a name (for example `Marsad alerts`) and a user name ending in `bot`. BotFather replies with a token. Copy it.
2. In GitHub: the repository, **Settings**, **Secrets and variables**, **Actions**, **New repository secret**. Name `TELEGRAM_BOT_TOKEN`, paste the token, tap **Add secret**.
3. In Telegram, open your new bot and tap **Start**, then send it any message.
4. In Safari, open `https://api.telegram.org/bot<TOKEN>/getUpdates`, replacing `<TOKEN>` with your token. Find `"chat":{"id":` and copy the number after it.
5. Add one more GitHub secret: name `TELEGRAM_CHAT_ID`, value that number.
6. To test: GitHub, **Actions**, **Web Push**, **Run workflow**, set **Send a test notification** to true, **Run workflow**. A Telegram message arrives within a few minutes.

## Step 8. Claude Code cloud environment network allow list

Claude's cloud sessions reach the internet only through hosts you allow. Connectors (Supabase, Netlify, Massive) do not need entries. In the Claude app, open the environment settings for this repository and allow these hosts as each phase needs them:

| Host                                          | Purpose                                    | Phase |
| --------------------------------------------- | ------------------------------------------ | ----- |
| `api.massive.com`                             | Massive REST API (confirm host in Phase 1) | 1     |
| `api.stlouisfed.org`                          | FRED API                                   | 1     |
| `www.sec.gov`, `data.sec.gov`, `efts.sec.gov` | SEC EDGAR                                  | 1     |
| `www.nasdaqtrader.com`                        | Trade halts RSS                            | 1     |
| `www.matteoiacoviello.com`                    | Geopolitical Risk Index files              | 1     |
| `www.federalreserve.gov`                      | FOMC calendar                              | 3     |
| `hwdwivilqdydmxhycapy.supabase.co`            | Live tests against your project            | 1     |
| `api.anthropic.com`                           | Prompt evaluation runs                     | 2     |

Package registries (npm) are allowed by default.

## Step 9. Email for the daily brief (free)

The pre-market brief and close recap are built every trading day and shown on the Watch page. To also get them by email:

1. On your iPad, open **resend.com** and tap **Sign up**. Use your personal email. The free plan is enough for two emails a day.
2. In Resend, tap **API Keys**, then **Create API Key**. Name it `Marsad`, permission **Sending access**. Tap **Add**, then copy the key (it is shown once).
3. In GitHub: the repository, **Settings**, **Secrets and variables**, **Actions**, **New repository secret**. Name `RESEND_API_KEY`, paste the key, tap **Add secret**.
4. Add one more secret: name `BRIEF_EMAIL_TO`, value the same email you signed up to Resend with. Until you verify a domain, Resend only delivers to that address.
5. Tell Claude "email secrets added". Claude runs the brief once and checks the delivery log.

The same two secrets also send an email copy of every critical and system alert, and a digest of alerts held back by quiet hours or the daily push limit (with the pre-market brief and the close recap). Nothing else is needed.

Optional, only if you want password-reset emails from your own address: Resend needs a domain you own (Resend, **Domains**, **Add Domain**). Then in Supabase: **Authentication**, **Emails**, **SMTP Settings**, turn on **Enable custom SMTP**, and fill in the host, port, user name and password shown on Resend's SMTP page (the password is a Resend API key). Marsad works without this.

## Step 10. Notifications on your iPad (free)

Alerts, system alerts and briefs can arrive as notifications. iPadOS sends them only to web apps on the Home Screen.

1. On your iPad, open Marsad in **Safari**, tap **Share**, then **Add to Home Screen**, then **Add**. From now on, open Marsad from the Home Screen icon.
2. In Marsad, sign in, tap **Status**, scroll to **Notifications** and tap **Create keys**. A private key appears once. Tap **Copy private key**.
3. In GitHub: the repository, **Settings**, **Secrets and variables**, **Actions**, **New repository secret**. Name `VAPID_PRIVATE_KEY`, paste the key, tap **Add secret**.
4. Back in Marsad (**Status**, **Notifications**), tap **Turn on for this device**, then **Allow**. The device appears in the list. Repeat this step on any other device.
5. To test: in GitHub, tap **Actions**, choose **Web Push**, then **Run workflow**, set **Send a test notification** to true and tap **Run workflow**. A test notification arrives within a few minutes.
6. Tell Claude "push secret added". Claude checks the delivery log.

If notifications stop: on the iPad, open **Settings**, **Notifications**, **Marsad** and turn on **Allow Notifications**; then check the device's state on the Status page.

## Costs so far

| Item                                      | Monthly cost | Approved                  |
| ----------------------------------------- | ------------ | ------------------------- |
| Supabase Free (Personal Projects)         | USD 0        | Created by you 2026-11-23 |
| Netlify (personal Free, or existing team) | USD 0 extra  | Pending step 3            |
| Massive free tier                         | USD 0        | In use                    |

Paid data plans and Supabase Pro are decided at Phase 5 and Phase 6. Claude asks before any of them.

## Step 11. Start the jobs on time from Supabase (ADR 0008, free)

GitHub's own timer skips most scheduled runs here. Supabase starts them instead, using a GitHub token that can do one thing: start this repository's workflows.

1. **Supabase extensions.** In Supabase, open the Marsad project, tap **Database**, then **Extensions**. Search for `pg_cron` and turn it on. Search for `pg_net` and turn it on (if it asks for a schema, choose `extensions`).
2. **GitHub token.** On github.com tap your picture, then **Settings**, **Developer settings**, **Personal access tokens**, **Fine-grained tokens**, **Generate new token**.
   - Token name: `Marsad scheduler`. Expiration: the longest offered (1 year). When it expires, the Status page shows the `scheduler` job as an error.
   - Repository access: **Only select repositories**, then **Marsad**.
   - Permissions, Repository permissions: **Actions**, set to **Read and write**. Leave everything else as it is.
   - Tap **Generate token** and copy it. Never paste it into chat.
3. **Store it in Supabase Vault.** In Supabase tap **SQL Editor**, then **New query**, paste the line below, replace `PASTE_TOKEN_HERE` with the token (keep the quotes), and tap **Run**:

   ```sql
   select vault.create_secret('PASTE_TOKEN_HERE', 'github_actions_token', 'Marsad scheduler, ADR 0008');
   ```

   To replace an expired token later: `select vault.update_secret((select id from vault.secrets where name = 'github_actions_token'), 'NEW_TOKEN');`

4. **Check.** Within 15 minutes the Status page lists a `scheduler` job run. "ok" means GitHub accepted every start; "skipped" means the token is not stored yet; "error" shows GitHub's reason.
