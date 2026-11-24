#!/usr/bin/env node
/**
 * Copies packages/core/src into supabase/functions/_shared/core so Edge Functions (Deno) can import the
 * shared engine with plain relative paths (docs/adr/0004-deployment.md). Two changes are made to the copy:
 *
 * 1. Test files and test fixtures are left out.
 * 2. Relative imports written for Node and TypeScript ("./time.js") are rewritten to the real file
 *    ("./time.ts"), because Deno resolves exact file names and the Edge Function bundler takes no flags.
 *
 * The copy is generated and git-ignored; never edit it by hand. Run: node scripts/prepare-edge-core.mjs
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'packages', 'core', 'src');
const to = join(root, 'supabase', 'functions', '_shared', 'core');

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });

// `from './x.js'`, `import './x.js'`, `import('./x.js')` and `export ... from './x.js'`, relative paths only.
const SPECIFIER = /(\bfrom\s*|\bimport\s*\(?\s*)(['"])(\.{1,2}\/[^'"]*?)\.js\2/g;

let files = 0;
let rewritten = 0;
for (const file of walk(from)) {
  if (/\.test\.ts$/.test(file) || !file.endsWith('.ts')) continue;
  const out = join(to, relative(from, file));
  mkdirSync(dirname(out), { recursive: true });
  const src = readFileSync(file, 'utf8');
  const next = src.replace(SPECIFIER, (_m, lead, q, path) => {
    rewritten += 1;
    return `${lead}${q}${path}.ts${q}`;
  });
  writeFileSync(out, next);
  files += 1;
}
// Anything left over would still fail under Deno, so fail here with the file and line.
const leftovers = [];
for (const file of walk(to)) {
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (/(from|import)\s*\(?\s*['"]\.{1,2}\/[^'"]*\.js['"]/.test(line))
        leftovers.push(`${relative(root, file)}:${i + 1}: ${line.trim()}`);
    });
}
if (leftovers.length > 0) {
  console.error(`Unrewritten .js imports:\n${leftovers.join('\n')}`);
  process.exit(1);
}
console.log(
  `Edge core: ${files} files copied to ${relative(root, to)}, ${rewritten} imports rewritten.`,
);
