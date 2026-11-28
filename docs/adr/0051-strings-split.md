# ADR 0051: UI strings split into per-area modules

- Status: accepted (batch 1 of ADR 0048, section 4 "Strings")
- Date: 2026-11-28

## Context

CLAUDE.md says every UI string lives in `apps/web/src/strings.ts`. By the end of the research, portfolio and movers work that file held about 4,160 lines in one object. Four agents worked on four pages in parallel, each adding to its own section, and their branches collided in the same file at every merge: the conflicts were in unrelated sections that happened to sit next to each other. ADR 0048 (section 4) asked for the file to be split so that parallel work stops colliding.

## Decision

1. **One module per area under `apps/web/src/strings/`:** `common`, `auth`, `shell` (navigation, page titles, footer, clock, the shell chrome and the Arabic `ar` labels), `watch` (with the watchlist editor, trader columns and the economic calendar), `markets` (added with the Markets page), `study`, `research` (the Study research views, nested as `t.study.research`), `quickLook`, `portfolio`, `journal`, `alerts`, `lab`, `regime`, `status` and `settings`. Each exports one `as const` object per top-level key of `t`.
2. **`strings.ts` stays the only import.** It gathers the modules into the same `t` object (same keys, same nesting, same types) and re-exports `ar` and `PageKey`, so `import { t } from '../strings'` is unchanged everywhere. Pages never import a module from `strings/` directly.
3. **The rule holds through the index.** "All UI strings in `strings.ts`" now reads "all UI strings in `strings.ts` or the modules it gathers". A string in a component file is still a defect.
4. **No text changed in the split.** The split was checked by bundling the old file and the new index with esbuild and comparing every value deeply (functions by their output on probe arguments): identical.
5. **Who edits what.** An agent edits the module of its own page. The shell module (`nav`, `pages`, `shell`, `ar`) and the index belong to the one agent per wave that owns `router.tsx` and `Shell.tsx` (ADR 0048, section 4 "Shared shell").

## Consequences

- Merges between agents working on different pages no longer touch the same file, except the small index when a new area is added.
- `t`'s type is unchanged, so TypeScript still catches a missing or misspelt key at build time.
- A future Arabic option swaps or adds modules instead of editing one large file.
