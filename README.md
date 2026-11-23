# Marsad

Marsad (مرصد, "observatory") is a private market-intelligence terminal for one user. It watches US stocks, ETFs and options, explains what is moving and why, and sends few, evidence-backed alerts. It never places orders.

- Build brief: [docs/BUILD_PROMPT.md](docs/BUILD_PROMPT.md)
- Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/adr/](docs/adr/)
- Setup steps for accounts and secrets: [docs/SETUP.md](docs/SETUP.md)
- Progress: [docs/PROGRESS.md](docs/PROGRESS.md)

## Develop

Requires Node.js 22 and pnpm 10.

```sh
./init.sh          # install, typecheck, lint, unit and database tests
pnpm --filter @marsad/web dev
pnpm e2e           # Playwright smoke tests (builds the app first)
```
