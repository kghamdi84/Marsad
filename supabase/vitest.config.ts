import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'database', include: ['tests/**/*.test.ts'], testTimeout: 30000, hookTimeout: 60000 },
});
