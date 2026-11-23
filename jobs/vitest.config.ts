import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { name: 'jobs', include: ['src/**/*.test.ts'] } });
