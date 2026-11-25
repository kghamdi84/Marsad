import { describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import type { JobRunRecord } from '@marsad/core';
import {
  runPushJob,
  type PendingPush,
  type PushDevice,
  type PushSender,
  type PushStore,
  type PushTable,
} from './push-job.js';
import { vapidPublicKeyFor } from './push-keys.js';

const KEY = 'B'.padEnd(87, 'A');
const NOW = new Date('2026-11-25T15:00:00Z');

function fakeStore(pending: PendingPush[], devices: PushDevice[], publicKey: string | null = KEY) {
  const deliveries = new Map<string, Record<string, string>>(
    pending.map((p) => [`${p.table}:${p.item.id}`, { ...p.delivery, push: 'pending' }]),
  );
  const deviceLog: { id: number; r: unknown }[] = [];
  const runs: JobRunRecord[] = [];
  const store: PushStore = {
    getPendingPush: () =>
      Promise.resolve(
        pending.filter((p) => deliveries.get(`${p.table}:${p.item.id}`)?.['push'] === 'pending'),
      ),
    setPushDelivery: (table: PushTable, id: string, expect: string, next) => {
      const k = `${table}:${id}`;
      if (deliveries.get(k)?.['push'] !== expect) return Promise.resolve(false);
      deliveries.set(k, next);
      return Promise.resolve(true);
    },
    getPushPublicKey: () => Promise.resolve(publicKey),
    getPushDevices: () => Promise.resolve(devices.map((d) => ({ ...d }))),
    recordDeviceResult: (id, r) => {
      deviceLog.push({ id, r });
      return Promise.resolve();
    },
    recordRun: (r) => {
      runs.push(r);
      return Promise.resolve();
    },
  };
  return { store, deliveries, deviceLog, runs };
}

const alertItem = (
  id: string,
  createdAt = '2026-11-25T14:59:00Z',
  priority = 'critical',
): PendingPush => ({
  table: 'alerts',
  item: {
    type: 'alert',
    id,
    priority: priority as 'critical',
    title: `[HALT, critical] NVDA: halted ${id}`,
    body: 'Nasdaq halt notice.',
    createdAt,
  },
  delivery: { push: 'pending', email: 'not-configured' },
});
const ipad: PushDevice = {
  id: 1,
  endpoint: 'https://web.push.apple.com/a',
  p256dh: 'p',
  auth: 'a',
  device: 'iPad',
  failures: 0,
};
const phone: PushDevice = {
  ...ipad,
  id: 2,
  endpoint: 'https://web.push.apple.com/b',
  device: 'iPhone',
};

function recorder(status: (d: PushDevice) => number = () => 201) {
  const sent: { device: number; payload: unknown; urgency: string; ttl: number }[] = [];
  const sender: PushSender = (d, payload, m) => {
    sent.push({
      device: d.id,
      payload: JSON.parse(payload),
      urgency: m.urgency,
      ttl: m.ttlSeconds,
    });
    const s = status(d);
    return Promise.resolve({
      ok: s >= 200 && s < 300,
      status: s,
      ...(s >= 300 ? { error: 'gone' } : {}),
    });
  };
  return { sent, sender };
}

describe('runPushJob', () => {
  it('sends each pending item to every device once and logs the result', async () => {
    const f = fakeStore([alertItem('a1'), alertItem('a2')], [ipad, phone]);
    const r = recorder();
    const run = await runPushJob({
      store: f.store,
      sender: r.sender,
      secretPublicKey: KEY,
      now: () => NOW,
    });
    expect(run.status).toBe('ok');
    expect(run.rows_written).toBe(2);
    expect(r.sent).toHaveLength(4);
    expect(r.sent[0]).toEqual({
      device: 1,
      payload: {
        title: '[HALT, critical] NVDA: halted a1',
        body: 'Nasdaq halt notice.',
        url: '/alerts#alert-a1',
        tag: 'alert-a1',
      },
      urgency: 'high',
      ttl: 7140,
    });
    expect(f.deliveries.get('alerts:a1')).toEqual({
      push: 'sent to 2 of 2 devices',
      email: 'not-configured',
      push_version: 'push-1',
      push_at: NOW.toISOString(),
    });
    // A second run finds nothing pending and sends nothing.
    const again = await runPushJob({
      store: f.store,
      sender: r.sender,
      secretPublicKey: KEY,
      now: () => NOW,
    });
    expect(again.rows_written).toBe(0);
    expect(r.sent).toHaveLength(4);
    expect(f.runs.map((x) => x.job)).toEqual(['push-dispatch', 'push-dispatch']);
  });

  it('does not send an alert that waited too long, and says so', async () => {
    const f = fakeStore([alertItem('old', '2026-11-25T12:00:00Z')], [ipad]);
    const r = recorder();
    const run = await runPushJob({
      store: f.store,
      sender: r.sender,
      secretPublicKey: KEY,
      now: () => NOW,
    });
    expect(r.sent).toHaveLength(0);
    expect(f.deliveries.get('alerts:old')?.['push']).toBe('expired (not sent within 2 h)');
    expect(run.details).toMatchObject({ expired: 1, sent: 0 });
  });

  it('records every pending item as not configured while the secret is missing, so nothing floods in later', async () => {
    const f = fakeStore([alertItem('a1')], [ipad]);
    const run = await runPushJob({
      store: f.store,
      sender: null,
      secretPublicKey: null,
      now: () => NOW,
    });
    expect(run.status).toBe('ok');
    expect(f.deliveries.get('alerts:a1')?.['push']).toBe(
      'not-configured (VAPID_PRIVATE_KEY secret missing)',
    );
  });

  it('records no keys and no devices plainly', async () => {
    const noKeys = fakeStore([alertItem('a1')], [ipad], null);
    await runPushJob({
      store: noKeys.store,
      sender: recorder().sender,
      secretPublicKey: KEY,
      now: () => NOW,
    });
    expect(noKeys.deliveries.get('alerts:a1')?.['push']).toBe(
      'not-configured (no keys created on the Status page)',
    );
    const none = fakeStore([alertItem('a1')], []);
    await runPushJob({
      store: none.store,
      sender: recorder().sender,
      secretPublicKey: KEY,
      now: () => NOW,
    });
    expect(none.deliveries.get('alerts:a1')?.['push']).toBe(
      'no devices (turn on notifications on the Status page)',
    );
  });

  it('fails the run when the secret does not match the saved public key', async () => {
    const f = fakeStore([alertItem('a1')], [ipad]);
    const run = await runPushJob({
      store: f.store,
      sender: recorder().sender,
      secretPublicKey: 'C'.padEnd(87, 'A'),
      now: () => NOW,
    });
    expect(run.status).toBe('error');
    expect(run.error).toMatch(/does not match/);
    expect(f.deliveries.get('alerts:a1')?.['push']).toMatch(/^failed/);
  });

  it('disables a device the push service says is gone and counts failures on others', async () => {
    const f = fakeStore([alertItem('a1')], [ipad, phone]);
    const r = recorder((d) => (d.id === 1 ? 410 : 500));
    const run = await runPushJob({
      store: f.store,
      sender: r.sender,
      secretPublicKey: KEY,
      now: () => NOW,
    });
    expect(run.status).toBe('error');
    expect(f.deviceLog).toEqual([
      { id: 1, r: { ok: false, error: '410: gone', failures: 1, disabledAt: NOW.toISOString() } },
      { id: 2, r: { ok: false, error: '500: gone', failures: 1, disabledAt: null } },
    ]);
    expect(f.deliveries.get('alerts:a1')?.['push']).toBe('failed (iPad 410: gone)');
  });

  it('counts a partial delivery as sent', async () => {
    const f = fakeStore([alertItem('a1')], [ipad, phone]);
    const r = recorder((d) => (d.id === 1 ? 201 : 500));
    const run = await runPushJob({
      store: f.store,
      sender: r.sender,
      secretPublicKey: KEY,
      now: () => NOW,
    });
    expect(run.status).toBe('ok');
    expect(f.deliveries.get('alerts:a1')?.['push']).toBe('sent to 1 of 2 devices');
  });

  it('never sends an item another dispatcher already claimed', async () => {
    const f = fakeStore([alertItem('a1')], [ipad]);
    // Another run claims the item between this run's read and its claim.
    const realGet = f.store.getPendingPush;
    f.store.getPendingPush = async () => {
      const rows = await realGet();
      await f.store.setPushDelivery('alerts', 'a1', 'pending', { push: 'sending' });
      return rows;
    };
    const r = recorder();
    const run = await runPushJob({
      store: f.store,
      sender: r.sender,
      secretPublicKey: KEY,
      now: () => NOW,
    });
    expect(r.sent).toHaveLength(0);
    expect(run.details).toMatchObject({ claimedElsewhere: 1, sent: 0 });
  });

  it('sends a test message to every device on request', async () => {
    const f = fakeStore([], [ipad, phone]);
    const r = recorder();
    const run = await runPushJob({
      store: f.store,
      sender: r.sender,
      secretPublicKey: KEY,
      now: () => NOW,
      test: true,
    });
    expect(run.job).toBe('push-test');
    expect(run.status).toBe('ok');
    expect(r.sent.map((s) => s.payload)).toEqual([
      {
        title: 'Marsad test notification',
        body: 'Sent 2026-11-25 15:00 UTC. Notifications reach this device.',
        url: '/status',
        tag: 'test',
      },
      {
        title: 'Marsad test notification',
        body: 'Sent 2026-11-25 15:00 UTC. Notifications reach this device.',
        url: '/status',
        tag: 'test',
      },
    ]);
    const none = await runPushJob({
      store: fakeStore([], []).store,
      sender: r.sender,
      secretPublicKey: KEY,
      now: () => NOW,
      test: true,
    });
    expect(none.status).toBe('error');
  });
});

describe('vapidPublicKeyFor', () => {
  it('derives the same public key the browser exports for a generated pair', async () => {
    // The Status page generates keys with WebCrypto exactly like this.
    const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ]);
    const jwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
    const raw = Buffer.from(await webcrypto.subtle.exportKey('raw', pair.publicKey)).toString(
      'base64url',
    );
    expect(raw).toHaveLength(87);
    expect(vapidPublicKeyFor(jwk.d ?? '')).toBe(raw);
  });
  it('matches a fixed vector (private scalar 1 gives the P-256 generator point)', () => {
    const one = Buffer.alloc(32);
    one[31] = 1;
    // SEC 2 v2, section 2.4.2: G = 04 6B17D1F2... 4FE342E2...
    const g = Buffer.from(
      '046b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c2964fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5',
      'hex',
    ).toString('base64url');
    expect(vapidPublicKeyFor(one.toString('base64url'))).toBe(g);
  });
  it('refuses a malformed key without echoing it', () => {
    expect(() => vapidPublicKeyFor('secret-but-short')).toThrow(
      /^VAPID_PRIVATE_KEY is not a 32-byte base64url key$/,
    );
  });
});
