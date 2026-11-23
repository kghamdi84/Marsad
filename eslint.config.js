import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dev-dist/**',
      '**/coverage/**',
      'supabase/functions/**',
      '**/test-results/**',
      '**/playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: globals.browser },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['**/*.config.{js,ts}', 'scripts/**', 'jobs/**', 'supabase/tests/**', 'apps/web/e2e/**'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.test.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
