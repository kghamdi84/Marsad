import { chromium } from '@playwright/test';
const [, , name, w, h, path, ...rest] = process.argv;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
await p.goto('http://localhost:4173' + path);
await p.waitForTimeout(800);
for (const a of rest) {
  const [kind, ...v] = a.split('::');
  if (kind === 'click') await p.getByRole('button', { name: v[0], exact: true }).click();
  if (kind === 'fill') await p.getByLabel(v[0]).fill(v[1]);
  await p.waitForTimeout(150);
}
await p.screenshot({ path: `/tmp/shots/${name}.png`, fullPage: true });
await b.close();
