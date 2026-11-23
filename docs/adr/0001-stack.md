# ADR 0001: Application stack and repository layout

- Status: accepted
- Date: 2026-11-23

## Context

Marsad has one user, runs on free or low-cost managed services, and must run the same calculation code in the browser, in Supabase Edge Functions (Deno) and in Node batch jobs. Correctness of financial math matters more than feature speed.

## Decision

- pnpm workspaces monorepo: `apps/web`, `packages/core`, `supabase/` (migrations, functions, tests), `jobs/`, `fixtures/`, `docs/`.
- Web: Vite 8, React 19, TypeScript, TanStack Router (code-based route tree, no generator) and TanStack Query, Tailwind CSS 4, Radix primitives where a widget needs accessible behavior, vite-plugin-pwa.
- TypeScript is pinned to 6.0.x, not 7.0. typescript-eslint 8.73 declares `typescript >=4.8.4 <6.1.0` as its peer range (checked with `npm view` on 2026-11-23). Revisit when typescript-eslint supports 7.x.
- `packages/core` is pure TypeScript: its tsconfig has `lib: ["ES2023"]` and `types: []`, so DOM, Node and Deno globals fail to type-check there. Only `Intl`, `Math` and `Date` from the language are available. This is what lets one engine run in all three runtimes.
- Tests: Vitest for unit and integration tests; Playwright for end-to-end checks; PGlite (Postgres compiled to WebAssembly) runs every migration and the row-level-security tests offline in CI, without Docker.
- Lint and format: ESLint flat config with typescript-eslint, Prettier.

## Consequences

- One `pnpm install` sets up everything; CI needs no database server or secrets.
- PGlite is real Postgres but not Supabase. A small harness (`supabase/tests/harness.sql`) recreates the parts of Supabase that policies rely on (`auth.uid()`, `auth.jwt()`, the `anon`, `authenticated` and `service_role` roles). Policies are also checked against the live project after each migration.
