// Fails the build when the main entry chunk exceeds its budget (apps/web/bundle-budget.mjs). Run after
// `vite build`: node apps/web/scripts/check-bundle.mjs
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import budget from '../bundle-budget.mjs';

const fail = (message) => {
  process.stderr.write(`check-bundle: ${message}\n`);
  process.exit(1);
};
const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(web, 'dist', 'index.html'), 'utf8');
const entry = /<script type="module"[^>]*src="\/(assets\/index-[^"]+\.js)"/.exec(html)?.[1];
if (!entry) fail('no entry script found in dist/index.html');
const size = statSync(join(web, 'dist', entry)).size;
const max = budget.entryMaxBytes;
const kb = (n) => `${(n / 1000).toFixed(1)} KB`;
process.stdout.write(
  `check-bundle: ${entry} is ${kb(size)} (${size} bytes); budget ${kb(max)} (${max} bytes)\n`,
);
if (size > max) fail(`the main entry chunk is ${size - max} bytes over its budget`);
