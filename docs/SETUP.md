# Marsad setup (for Khaled, on iPad)

These are the steps only you can do: creating accounts, approving costs and adding secrets. Each step says what to tap. Do them in order. When a step says **Tell Claude**, paste the listed values into the Claude Code session.

Never paste a secret key, password or token into the chat. Steps that involve secrets say where to put them instead.

## Accounts Marsad uses

| Service               | Account to use                                             | Status          |
| --------------------- | ---------------------------------------------------------- | --------------- |
| Supabase organization | Your **personal** organization (to be created, see step 1) | Not created yet |
| Supabase project      | `marsad` inside that personal organization, Free plan      | Not created yet |
| Netlify team          | To be confirmed by you (see step 3)                        | Not confirmed   |
| Netlify site          | `marsad-<something>.netlify.app`                           | Not created yet |
| GitHub                | This private repository                                    | Exists          |

Claude fills in this table as you confirm each item.

### What the connectors can see today (checked 2026-11-23)

- Supabase connector: one organization, **Gulf Insulation Group**, with six existing projects (GIGAdvancePayments, sar-portfolio-tracker, OneGIG, gig-legal, gig-work-intake, gig-productivity-ledger). This is a work organization. Marsad will not use it.
- Netlify connector: one team named **GIG**, slug `khaled-alghamdi-84`, Pro plan, one member (you, Owner). The name suggests work; the slug suggests personal. Claude needs your decision before using it (step 3).

## Step 1. Create a personal Supabase organization and project

Cost: USD 0 (Free plan). You upgrade to Pro (USD 25 per month) before live alerts in Phase 5, not now.

1. In Safari, open `https://supabase.com/dashboard`.
2. Tap the organization name at the top left (it shows **Gulf Insulation Group**), then tap **New organization**.
3. Name: `Khaled Personal`. Type: **Personal**. Plan: **Free**. Tap **Create organization**.
4. Inside the new organization, tap **New project**.
   - Name: `marsad`
   - Database password: tap **Generate a password**, then save it in your password manager. Claude never needs it in chat.
   - Region: **Central EU (Frankfurt)** (`eu-central-1`). It is a reasonable middle point between Riyadh, where you read the app, and the US data vendors. Pick a US East region instead if you prefer lower latency to the data vendors; tell Claude which you chose.
   - Tap **Create new project** and wait about two minutes.
   - If Supabase says you have reached the free project limit, stop and tell Claude. The fix is a decision for you (pause another free project, or start on Pro).
5. Reconnect the Supabase connector so it can see the new organization: in the Claude app, open **Settings**, then **Connectors**, then **Supabase**, tap **Disconnect**, then **Connect** again. On Supabase's approval screen, select **Khaled Personal** (you may leave Gulf Insulation Group unselected).
6. **Tell Claude:** "Supabase personal org and project created, region X."

Claude then confirms, through the connector, that it sees `Khaled Personal` and `marsad`, shows you the organization name, and waits for your "yes" before applying any migration.

## Step 2. Configure Supabase Auth (Claude cannot do this through the connector)

In the `marsad` project:

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

| Netlify variable                | Value                                                   | Secret?                                   |
| ------------------------------- | ------------------------------------------------------- | ----------------------------------------- |
| `VITE_SUPABASE_URL`             | Project URL, like `https://abcd.supabase.co`            | No. It is public by design.               |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | The **publishable** key (starts with `sb_publishable_`) | No. Row-level security protects the data. |

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
| `<your-project-ref>.supabase.co`              | Live tests against your project            | 1     |
| `api.anthropic.com`                           | Prompt evaluation runs                     | 2     |

Package registries (npm) are allowed by default.

## Costs so far

| Item                                      | Monthly cost | Approved       |
| ----------------------------------------- | ------------ | -------------- |
| Supabase Free                             | USD 0        | Pending step 1 |
| Netlify (personal Free, or existing team) | USD 0 extra  | Pending step 3 |
| Massive free tier                         | USD 0        | In use         |

Paid data plans and Supabase Pro are decided at Phase 5 and Phase 6. Claude asks before any of them.
