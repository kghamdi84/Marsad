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
