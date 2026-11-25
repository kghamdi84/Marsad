import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

// Cloud sessions ship a preinstalled Chromium; CI installs its own.
const preinstalled = '/opt/pw-browsers/chromium';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
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
    command: 'pnpm build && pnpm preview',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_SUPABASE_URL: 'https://e2e-test-project.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_e2e_test_key',
    },
  },
});
