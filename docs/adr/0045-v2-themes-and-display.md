# ADR 0045: Marsad v2 themes, Arabic and display preferences

Date: 2026-11-27. Status: accepted (Khaled asked for the v2 design to be implemented in full).

## Context

The Claude Design handoff "Marsad v2" adds a Daylight theme next to the navy theme, Arabic with right-to-left
layout, a second time zone, a Settings page and a header with all eight pages. Before v2 the colours were fixed
values in Tailwind's `@theme`, and every string was English.

## Decision

- **Tokens.** The v2 colours live as CSS variables under `[data-theme='dark']` (also `:root`) and
  `[data-theme='light']` in `apps/web/src/styles.css`. `@theme` maps them (`--color-surface: var(--c-surface)`), so
  one class works in both themes. The names used before v2 (`bg`, `raised`, `fg`, `muted`) stay as aliases. The old
  filled blue `ink` became `fill`; `ink` is now the heading colour, as in the handoff.
- **Display preferences on the device.** Theme, language and the second time zone are stored in the browser's
  local storage (`marsad.display`), not in Supabase: they are per-device conveniences, like brightness, and the
  page renders with the defaults (navy, English, Asia/Riyadh) when storage is blocked. They are applied to `<html>`
  (`data-theme`, `lang`, `dir`) before React renders, so the first paint has the right theme.
- **Arabic scope.** Navigation, page titles and subtitles and the footer notice are translated (`ar` in
  `strings.ts`), as in the handoff. All other text stays English for now. Numbers, tickers, dates and times keep
  their left-to-right order (`unicode-bidi: plaintext` on text elements in right-to-left pages, and the `Num`
  component with `dir="ltr"`).
- **Settings route.** The forms that sat under the Status page's Settings tab (notifications, quote source,
  preferences, exports) move to `/settings`, with the new Display and Security cards. Status shows health only.

## Consequences

- Daylight passes the same automated accessibility scan as the navy theme (Playwright `display.spec.ts`).
- The price chart redraws when the theme changes, since it reads the colours when it draws.
- A full Arabic translation of every page is later work; it needs the same `ar` structure for each page's strings.
