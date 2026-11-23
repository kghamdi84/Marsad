# Marsad setup (for Khaled, on iPad)

These are the steps only you can do: creating accounts, approving costs and adding secrets. Each step says what to tap. Do them in order. When a step says **Tell Claude**, paste the listed values into the Claude Code session.

Never paste a secret key, password or token into the chat. Steps that involve secrets say where to put them instead.

## Accounts Marsad uses

| Service               | Account                                                                           | Status                                          |
| --------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------- |
| Supabase organization | **Personal Projects** (Free), personal, may host other personal projects          | Created 2026-11-23                              |
| Supabase project      | "kghamdi84's Project", ref `hwdwivilqdydmxhycapy`, Tokyo (`ap-northeast-1`), Nano | Created 2026-11-23; connector cannot see it yet |
| Supabase GitHub link  | Linked to `kghamdi84/Marsad` when the project was created                         | Settings to confirm (step 1b)                   |
| Netlify team          | To be confirmed by you (see step 3)                                               | Not confirmed                                   |
| Netlify site          | `marsad-<something>.netlify.app`                                                  | Not created yet                                 |
| GitHub                | This private repository                                                           | Exists                                          |

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
   - **Deploy to production**: on
   - **Automatic branching**: off (preview branches need the Pro plan)
3. **Tell Claude:** "GitHub integration checked."

The first database migration is applied when pull request #1 is merged into `main`. Claude then verifies it through the connector.

## Step 2. Configure Supabase Auth (Claude cannot do this through the connector)

In the Supabase project (`hwdwivilqdydmxhycapy`):

1. Tap **Authentication** in the left menu, then **Sign In / Providers** (on some layouts: **Providers**).
   - Under **User Signups**, turn **Allow new users to sign up** **off**. This is what keeps Marsad single-user.
   - Under **Email**, keep **Email** enabled. Turn **Confirm email** on.
   - Set **Email OTP Length** to `6` and **Email OTP Expiration** to `600` seconds if those fields are shown.
2. Tap **Authentication**, then **Multi-Factor** (or **MFA**). Set **TOTP (App Authenticator)** to **Enabled**.
3. Tap **Authentication**, then **Emails** (or **Email Templates**), then **Magic Link**. Replace the body with the text below so the email shows a six-digit code instead of a link. Tap **Save**.

   ```html
   <h2>Your Marsad sign-in code</h2>
   <p>Enter this code in Marsad: <strong>{{ .Token }}</strong></p>
   <p>It expires in 10 minutes. If you did not try to sign in, ignore this email.</p>
   ```

4. Tap **Authentication**, then **Users**, then **Add user**, then **Create new user**. Email: your personal email. Turn **Auto Confirm User** on. Leave the password empty if allowed; otherwise use a long random one you discard. Tap **Create user**.
5. Tap **Authentication**, then **URL Configuration**. Set **Site URL** to the Netlify address from step 3 once it exists.
6. **Tell Claude:** "Auth configured."

Note: the built-in Supabase email sender is rate limited (a few emails per hour) and meant for testing. It is enough for one person signing in. A custom SMTP sender is set up in Phase 5 along with email digests.

## Step 3. Choose the Netlify team and create the site

Decision needed: is the Netlify team **GIG** (`khaled-alghamdi-84`) yours personally, or does it belong to Gulf Insulation Group?

- If it is personal: tell Claude "Use Netlify team GIG for Marsad."
- If it is a work team: create a personal team first. In Safari, open `https://app.netlify.com`, tap your avatar, then **Create new team**, name it `Khaled Personal`, choose the **Free** plan. Then reconnect the Netlify connector in the Claude app (**Settings**, **Connectors**, **Netlify**, **Disconnect**, **Connect**) and grant the new team.

Then create the site from GitHub so every push to `main` deploys and every branch gets a preview:

1. In `https://app.netlify.com`, switch to the chosen team.
2. Tap **Add new project**, then **Import an existing project**, then **GitHub**. Authorize Netlify for the `kghamdi84/Marsad` repository only.
3. Netlify reads `netlify.toml` from the repository, so leave the build settings as detected (build command `pnpm --filter @marsad/web build`, publish directory `apps/web/dist`).
4. Before the first deploy, tap **Add environment variables** and add the two values from step 4 below.
5. Tap **Deploy**. Under **Project configuration**, then **Change project name**, rename it to something like `marsad-k84` so the address is `marsad-k84.netlify.app`.
6. **Tell Claude:** the `*.netlify.app` address.

## Step 4. Netlify environment variables (browser-safe values only)

Find these in Supabase: **Project Settings**, then **API Keys** and **Data API**.

| Netlify variable                | Value                                                        | Secret?                                   |
| ------------------------------- | ------------------------------------------------------------ | ----------------------------------------- |
| `VITE_SUPABASE_URL`             | Project URL, like `https://hwdwivilqdydmxhycapy.supabase.co` | No. It is public by design.               |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | The **publishable** key (starts with `sb_publishable_`)      | No. Row-level security protects the data. |

Never put the **secret** key (starts with `sb_secret_`) or the old `service_role` key into Netlify. Claude can also read these two public values through the Supabase connector and set them for you if you prefer.

## Step 5. GitHub Actions secrets (Phase 1, not needed yet)

CI for Phase 0 needs no secrets. From Phase 1, scheduled jobs and deployments need these. Add them in GitHub: open the repository, tap **Settings**, **Secrets and variables**, **Actions**, **New repository secret**.

| Secret                  | Where to find it                                                                         | Phase |
| ----------------------- | ---------------------------------------------------------------------------------------- | ----- |
| `SUPABASE_ACCESS_TOKEN` | supabase.com, avatar, **Account preferences**, **Access Tokens**, **Generate new token** | 1     |
| `SUPABASE_PROJECT_REF`  | The `abcd` part of the project URL                                                       | 1     |
| `SUPABASE_DB_PASSWORD`  | The password you saved in step 1                                                         | 1     |
| `SUPABASE_URL`          | Project URL                                                                              | 1     |
| `SUPABASE_SECRET_KEY`   | Supabase, **Project Settings**, **API Keys**, secret key                                 | 1     |
| `MASSIVE_API_KEY`       | massive.com dashboard, **API Keys**                                                      | 1     |
| `FRED_API_KEY`          | `https://fredaccount.stlouisfed.org/apikeys` (free)                                      | 1     |
| `SEC_USER_AGENT`        | Text like `Marsad your-email@example.com` (SEC requires a contact)                       | 1     |
| `ANTHROPIC_API_KEY`     | console.anthropic.com, **API Keys**                                                      | 2     |

## Step 6. Supabase Edge Function secrets (Phase 1, not needed yet)

In Supabase: **Edge Functions**, then **Secrets**, then **Add new secret**. Same names as the data keys above (`MASSIVE_API_KEY`, `FRED_API_KEY`, `SEC_USER_AGENT`, later `ANTHROPIC_API_KEY`). Claude can also add these through the connector if you paste them into the secure form it shows, never into chat.

## Step 7. Optional: Telegram bot (Phase 5)

1. In Telegram, open a chat with `@BotFather`, send `/newbot`, choose a name like `Marsad Alerts` and a username ending in `bot`.
2. BotFather replies with a token. Store it only as the Supabase secret `TELEGRAM_BOT_TOKEN`.
3. Send any message to your new bot, then tell Claude "Telegram bot ready"; Claude reads your chat ID from the bot's updates.

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

## Costs so far

| Item                                      | Monthly cost | Approved                  |
| ----------------------------------------- | ------------ | ------------------------- |
| Supabase Free (Personal Projects)         | USD 0        | Created by you 2026-11-23 |
| Netlify (personal Free, or existing team) | USD 0 extra  | Pending step 3            |
| Massive free tier                         | USD 0        | In use                    |

Paid data plans and Supabase Pro are decided at Phase 5 and Phase 6. Claude asks before any of them.
