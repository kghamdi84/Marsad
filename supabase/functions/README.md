# Edge Functions

Deno functions deployed to Supabase. The first ones (`tick` and the source adapters) arrive in Phase 1.

Functions import the shared engine from `./_shared/core/`, a generated copy of `packages/core/src` made by the deploy step (see docs/adr/0004-deployment.md). Never edit that copy by hand.
