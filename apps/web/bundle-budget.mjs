/**
 * Bundle budget (ADR 0048 section 4 "Loading", ADR 0053). The main entry chunk is the script `dist/index.html`
 * loads first (`dist/assets/index-*.js`): the shell, Watch and what they import. Every other page and every
 * Study view is a lazy chunk and is not counted here.
 *
 * Measured 2026-11-28 after the Study views became lazy chunks, built as CI builds it (`pnpm build`, no VITE_
 * variables): 329,004 bytes. The budget is that size plus 10%. (With the Supabase address and key set, as for
 * Playwright and production, the chunk is 332,743 bytes.) Raise it only on purpose, in the same change that
 * explains why, with a new measurement.
 */
export default {
  entryMaxBytes: 361_904,
};
