// Renders public/icon.svg to the PNG sizes iOS and the web manifest need.
// Run once after changing the icon: node apps/web/scripts/gen-icons.mjs
import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const pub = join(import.meta.dirname, '..', 'public');
const svg = readFileSync(join(pub, 'icon.svg'), 'utf8');
const preinstalled = '/opt/pw-browsers/chromium';
const browser = await chromium.launch(
  existsSync(preinstalled) ? { executablePath: preinstalled } : {},
);
for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<html><body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`,
  );
  await page.screenshot({ path: join(pub, name), omitBackground: false });
  await page.close();
}
await browser.close();
