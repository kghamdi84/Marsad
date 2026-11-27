import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

// Cloud sessions ship a preinstalled Chromium; CI installs its own.
const preinstalled = '/opt/pw-browsers/chromium';
// PW_PORT lets two checkouts run their suites side by side.
const port = Number(process.env['PW_PORT'] ?? 4173);

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    launchOptions: existsSync(preinstalled) ? { executablePath: preinstalled } : {},
  },
  // Desktop, and an iPad-sized touch screen (Khaled's device, Phase 8 pass): every test and scan runs on both.
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 720 } } },
    {
      name: 'ipad',
      use: { viewport: { width: 834, height: 1194 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: {
    // A fake project address: tests intercept every Supabase request.
    command: `pnpm build && pnpm preview --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_SUPABASE_URL: 'https://e2e-test-project.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_e2e_test_key',
    },
  },
});
