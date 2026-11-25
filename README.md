# Marsad

Marsad (مرصد, "observatory") is a private market-intelligence terminal for one user. It watches US stocks, ETFs and the macro backdrop, explains what is moving and why, and raises few, evidence-backed alerts. It never places orders: every trade is placed by hand in Sahm, a broker with no API.

This README is for whoever maintains the code. For account setup, see [docs/SETUP.md](docs/SETUP.md). For what is live, see [docs/PROGRESS.md](docs/PROGRESS.md).

## What Marsad does

| Page    | What it shows                                                                                                                                                                                          |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Watch   | Market strip, watchlist, sector heatmap, movers, gap scanner, news, economic and earnings calendars, the latest brief.                                                                                 |
| Study   | A company page: chart with indicators and filing markers, financials as filed, filings with 8-K item labels, insiders (Forms 3, 4 and 5), short data, earnings history, risk-factor diff, tiered news. |
| Regime  | Regime label with event-study statistics, breadth, Fear and Greed composite with its components, capitulation watch, geopolitical panel.                                                               |
| Alerts  | Every signal the pipeline judged, with its decision, reasons, card and one-tap feedback.                                                                                                               |
| Journal | Position sizer and Sahm order ticket (copy only after the checklist), holdings with exit rules, exposure, beta and stress scenarios, stock-to-ETF rotation.                                            |
| Lab     | Playbooks, rule versions, backtests with intervals, walk-forward and holdout results, lifecycle status.                                                                                                |
| Status  | Freshness of every source, job runs and system alerts.                                                                                                                                                 |

What it does not do: hold positions by default, place orders, store brokerage credentials, or let a language model decide or calculate. Code decides and calculates; text explains.

## Architecture

- **Web app** (`apps/web`): React, TanStack Router and Query, Tailwind, Lightweight Charts. A PWA hosted on Netlify (site `marsad-k84`). It reads Supabase through row-level security with the publishable key only.
- **Calculation engine** (`packages/core`): pure TypeScript with no DOM, Node or Deno APIs, shared by the web app, the jobs and Supabase Edge Functions. Indicators, statistics, the rule language, the backtester, the alert pipeline, portfolio math and every vendor adapter live here.
- **Jobs** (`jobs`): Node scripts run by GitHub Actions on a schedule. They fetch data, compute, and write to Supabase with the secret key. Every run writes `public.job_runs`.
- **Database** (`supabase`): Postgres migrations, applied by the Supabase GitHub integration when a pull request merges. Tests run every migration in PGlite and check row-level security offline.

Decisions and their reasons are in [docs/adr/](docs/adr/) (one file per decision) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Data sources, endpoints and plan limits are in [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md).

## Repository layout

```text
apps/web/            React PWA; e2e/ holds the Playwright tests
packages/core/       The calculation engine and adapters, with known-answer tests
jobs/                Scheduled jobs (entry points *-main.ts) and their tests
supabase/            Migrations, row-level security tests, Edge Function shared code
fixtures/            Recorded vendor responses (keys stripped) and reference answers
scripts/             Edge Function core preparation and the Node and Deno parity check
docs/                Brief, setup, progress, checklist, decisions, data sources, security review
.github/workflows/   CI and the scheduled jobs
```

## Develop

Requires Node.js 22 and pnpm 10.

```sh
./init.sh                      # install, typecheck, lint, unit and database tests
pnpm --filter @marsad/web dev  # the app at http://localhost:5173
pnpm e2e                       # Playwright on desktop and iPad sizes, with WCAG 2.2 AA scans
```

To run one job locally, set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (and the vendor key it needs) in your shell, then run, for example, `pnpm --filter @marsad/jobs fred`. Never commit keys: `.env.example` lists names only.

## Testing

- **Financial math** has known-answer tests against reference implementations (numpy, scipy, statsmodels) or hand-checked data, each with a stated tolerance. If a test looks wrong, raise it before changing it.
- **Database**: `supabase/tests` runs every migration and proves that only the owner, with an MFA session, can read anything; schema guards fail when a new table or policy breaks the rules.
- **Browser**: Playwright with every Supabase request mocked, on a desktop and an iPad-sized touch viewport; each test ends with an axe scan against WCAG 2.2 A and AA.
- **Edge parity**: CI runs the core in Node and in Deno on the same inputs and requires identical output.

## Scheduled jobs

All times are UTC. GitHub can start scheduled runs late; the heartbeat job raises a system alert when a source goes stale.

| Workflow                         | Schedule                                                  | Writes                                                        |
| -------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------- |
| Nasdaq halts                     | Every 5 minutes, weekdays                                 | Halts and halt alerts                                         |
| Heartbeat                        | Every 15 minutes in market hours, every 3 hours otherwise | Source health and system alerts                               |
| SEC filings and insider filings  | Hourly, weekdays                                          | Filings, Forms 3, 4 and 5                                     |
| SEC financial facts              | 06:15, weekdays                                           | Financial facts                                               |
| Massive reference data           | 05:30 daily                                               | Instruments, splits, holidays                                 |
| Massive universe breadth         | 10:40, Tuesday to Saturday                                | Universe, breadth, movers                                     |
| Massive news                     | 12:05, 15:05, 18:05, weekdays                             | News                                                          |
| Pre-market brief                 | 12:30 and 13:30, weekdays                                 | Brief (and email when configured)                             |
| Massive daily bars               | 22:30, weekdays                                           | Daily bars, then holding exit alerts                          |
| Close recap                      | 22:50, weekdays                                           | Brief                                                         |
| Massive short data and dividends | 23:15, weekdays                                           | Short interest and volume, dividends                          |
| FRED daily                       | 23:30 daily                                               | Macro series, regime, calendars, Fear and Greed, capitulation |
| Reconcile nightly                | 00:45 daily                                               | Cross-source checks                                           |
| Massive news topics              | 01:20 daily                                               | Geopolitical topic counts                                     |
| GPR daily                        | 06:17 daily                                               | Geopolitical risk index                                       |
| Massive 10-K sections            | 05:45, Sunday                                             | Annual report sections                                        |
| Backtest lab                     | 06:20, Sunday                                             | Rule versions and backtest runs                               |

## Security

- Row-level security on every table; every policy requires an MFA (aal2) session; sign-ups are disabled.
- The browser holds only the publishable key. The secret key lives in GitHub Actions secrets and Supabase.
- Strict Content Security Policy, `noindex`, and no framing; GitHub Actions pinned to commit SHAs.
- The full review and its open items: [docs/SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md).

## Writing style

Google developer documentation style, no em dashes, and every UI string in `apps/web/src/strings.ts`. The standing rules for contributors, human or AI, are in [CLAUDE.md](CLAUDE.md).
