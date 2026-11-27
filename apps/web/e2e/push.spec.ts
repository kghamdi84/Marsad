import { createECDH } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { seedSession, scanAfterEach } from './helpers';

scanAfterEach();

const json = (body: unknown, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

async function mockPush(
  page: Page,
  opts: { key: string | null; devices: Record<string, unknown>[] },
): Promise<{ saved: unknown[]; deleted: string[] }> {
  const saved: unknown[] = [];
  const deleted: string[] = [];
  let key = opts.key;
  await page.route('**/rest/v1/**', (r) => r.fulfill(json([])));
  await page.route('**/rest/v1/user_settings**', (r) => {
    if (r.request().method() === 'POST') {
      const body = r.request().postDataJSON() as { push_public_key?: string };
      saved.push(body);
      key = body.push_public_key ?? key;
      return r.fulfill({ status: 201, body: '' });
    }
    return r.fulfill(json(key === null ? [] : [{ push_public_key: key }]));
  });
  await page.route('**/rest/v1/push_subscriptions**', (r) => {
    if (r.request().method() === 'DELETE') {
      deleted.push(r.request().url());
      return r.fulfill({ status: 204, body: '' });
    }
    return r.fulfill(json(opts.devices));
  });
  return { saved, deleted };
}

const dev = (section: ReturnType<Page['getByRole']>, name: string) =>
  section.getByRole('button', { name: new RegExp(`^Remove ${name}`) }).locator('xpath=..');

test('creating keys saves only the public key; the private key never leaves the page', async ({
  page,
}) => {
  await seedSession(page, 'aal2');
  const m = await mockPush(page, { key: null, devices: [] });
  const sent: string[] = [];
  page.on('request', (r) => sent.push(`${r.url()} ${r.postData() ?? ''}`));
  await page.goto('/status');
  // Setup forms sit under Settings (council batch 2).
  await page
    .getByRole('navigation', { name: 'Main sections' })
    .getByRole('link', { name: 'Settings' })
    .click();
  const section = page.getByRole('region', { name: 'Notifications' });
  await expect(section.getByText('No keys yet.')).toBeVisible();
  await expect(section.getByText('Create the keys first.')).toBeVisible();
  await section.getByRole('button', { name: 'Create keys' }).click();

  const field = section.getByLabel('Private key (shown once, not stored by Marsad)');
  await expect(field).toHaveValue(/^[A-Za-z0-9_-]{43}$/);
  const privateKey = await field.inputValue();
  await expect(section.getByText(/Name it VAPID_PRIVATE_KEY/)).toBeVisible();

  // The saved public key is the one the dispatcher derives from the private key (job check, ADR 0031).
  expect(m.saved).toHaveLength(1);
  const publicKey = (m.saved[0] as { push_public_key: string }).push_public_key;
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(privateKey, 'base64url'));
  expect(publicKey).toBe(ecdh.getPublicKey('base64url', 'uncompressed'));
  expect(sent.some((s) => s.includes(privateKey))).toBe(false);

  await expect(section.getByText('Keys ready')).toBeVisible();
  await expect(section.getByRole('button', { name: 'Turn on for this device' })).toBeVisible();
});

test('the device list says which devices work, which fail and which the push service stopped', async ({
  page,
}) => {
  await seedSession(page, 'aal2');
  const m = await mockPush(page, {
    key: 'B'.padEnd(87, 'A'),
    devices: [
      {
        id: 1,
        endpoint: 'https://web.push.apple.com/a',
        device: 'iPad',
        created_at: '2026-11-25T12:00:00Z',
        last_ok_at: '2026-11-25T14:00:00Z',
        last_error: null,
        failures: 0,
        disabled_at: null,
      },
      {
        id: 2,
        endpoint: 'https://web.push.apple.com/b',
        device: 'iPhone',
        created_at: '2026-11-25T12:00:00Z',
        last_ok_at: null,
        last_error: '500: server error',
        failures: 2,
        disabled_at: null,
      },
      {
        id: 3,
        endpoint: 'https://fcm.googleapis.com/fcm/send/c',
        device: 'Mac',
        created_at: '2026-11-20T12:00:00Z',
        last_ok_at: null,
        last_error: '410: gone',
        failures: 1,
        disabled_at: '2026-11-21T12:00:00Z',
      },
    ],
  });
  await page.goto('/status');
  // Setup forms sit under Settings (council batch 2).
  await page
    .getByRole('navigation', { name: 'Main sections' })
    .getByRole('link', { name: 'Settings' })
    .click();
  const section = page.getByRole('region', { name: 'Notifications' });
  await expect(dev(section, 'iPad')).toContainText('Active');
  await expect(dev(section, 'iPhone')).toContainText('Failing (2 in a row): 500: server error');
  await expect(dev(section, 'iPhone')).toContainText('Never');
  await expect(dev(section, 'Mac')).toContainText('Stopped by the push service');
  await section.getByRole('button', { name: 'Remove iPhone' }).click();
  await expect.poll(() => m.deleted.length).toBe(1);
  expect(m.deleted[0]).toContain('id=eq.2');

  // Replacing keys asks first and says what it costs.
  await section.getByRole('button', { name: 'Replace keys' }).click();
  await expect(section.getByText(/New keys stop every device/)).toBeVisible();
  await section.getByRole('button', { name: 'Cancel' }).click();
  await expect(section.getByText(/New keys stop every device/)).toHaveCount(0);
  expect(m.saved).toHaveLength(0);
});

test('a refused permission prompt explains where to allow notifications', async ({ page }) => {
  await seedSession(page, 'aal2');
  await page.addInitScript(() => {
    Notification.requestPermission = () => Promise.resolve('denied');
  });
  await mockPush(page, { key: 'B'.padEnd(87, 'A'), devices: [] });
  await page.goto('/status');
  // Setup forms sit under Settings (council batch 2).
  await page
    .getByRole('navigation', { name: 'Main sections' })
    .getByRole('link', { name: 'Settings' })
    .click();
  const section = page.getByRole('region', { name: 'Notifications' });
  await section.getByRole('button', { name: 'Turn on for this device' }).click();
  await expect(section.getByRole('alert')).toContainText('Allow Notifications');
});
