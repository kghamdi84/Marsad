import { fromBase64Url, isAllowedPushEndpoint, toBase64Url } from '@marsad/core';
import { supabase } from './supabase';

function client() {
  if (!supabase) throw new Error('not configured');
  return supabase;
}

export type PushSupport = 'supported' | 'needs-home-screen' | 'unsupported';

/** Whether this browser can subscribe. iPadOS and iOS offer push only to Home Screen web apps. */
export function pushSupport(): PushSupport {
  const hasPush =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (hasPush) return 'supported';
  const appleTouch =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  return appleTouch ? 'needs-home-screen' : 'unsupported';
}

export function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'Browser';
}

/**
 * A new VAPID key pair made on this device (P-256, WebCrypto). The public key is saved for subscribing; the
 * private key is returned once for the GitHub secret and never stored or sent anywhere by Marsad.
 */
export async function createKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  if (!jwk.d) throw new Error('The browser did not export the private key');
  return { publicKey: toBase64Url(raw), privateKey: jwk.d };
}

export interface PushDeviceRow {
  id: number;
  endpoint: string;
  device: string;
  createdAt: string;
  lastOkAt: string | null;
  lastError: string | null;
  failures: number;
  disabledAt: string | null;
}

export interface PushState {
  publicKey: string | null;
  devices: PushDeviceRow[];
  /** The endpoint this browser is subscribed with, if any. */
  thisEndpoint: string | null;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'supported') return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function loadPushState(): Promise<PushState> {
  const db = client();
  const [s, d] = await Promise.all([
    db.from('user_settings').select('push_public_key').maybeSingle(),
    db
      .from('push_subscriptions')
      .select('id, endpoint, device, created_at, last_ok_at, last_error, failures, disabled_at')
      .order('id'),
  ]);
  if (s.error) throw new Error(`user_settings: ${s.error.message}`);
  if (d.error) throw new Error(`push_subscriptions: ${d.error.message}`);
  const sub = await currentSubscription().catch(() => null);
  return {
    publicKey: (s.data?.['push_public_key'] as string | null | undefined) ?? null,
    devices: ((d.data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: Number(r['id']),
      endpoint: String(r['endpoint']),
      device: String(r['device'] ?? ''),
      createdAt: String(r['created_at']),
      lastOkAt: (r['last_ok_at'] as string | null) ?? null,
      lastError: (r['last_error'] as string | null) ?? null,
      failures: Number(r['failures'] ?? 0),
      disabledAt: (r['disabled_at'] as string | null) ?? null,
    })),
    thisEndpoint: sub?.endpoint ?? null,
  };
}

/** Saves a new public key. Devices subscribed with an older key can no longer be reached, so they are removed. */
export async function saveKeys(publicKey: string, hadDevices: boolean): Promise<void> {
  const db = client();
  if (hadDevices) {
    const del = await db.from('push_subscriptions').delete().gte('id', 0);
    if (del.error) throw new Error(`push_subscriptions: ${del.error.message}`);
    const sub = await currentSubscription().catch(() => null);
    await sub?.unsubscribe().catch(() => false);
  }
  const r = await db
    .from('user_settings')
    .upsert({ push_public_key: publicKey }, { onConflict: 'owner_id' });
  if (r.error) throw new Error(`user_settings: ${r.error.message}`);
}

export class PushDenied extends Error {}
export class PushEndpointRefused extends Error {}

/** Asks for permission (must run from a tap), subscribes with the saved key and stores the device. */
export async function turnOnThisDevice(publicKey: string): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new PushDenied('denied');
  const reg = await navigator.serviceWorker.ready;
  const key = fromBase64Url(publicKey);
  let sub = await reg.pushManager.getSubscription();
  const subKey = sub?.options.applicationServerKey;
  const sameKey =
    subKey !== null &&
    subKey !== undefined &&
    toBase64Url(new Uint8Array(subKey)) === toBase64Url(key);
  if (sub && !sameKey) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key.buffer.slice(
      key.byteOffset,
      key.byteOffset + key.byteLength,
    ) as ArrayBuffer,
  });
  const json = sub.toJSON();
  const p256dh = json.keys?.['p256dh'];
  const auth = json.keys?.['auth'];
  if (!json.endpoint || !isAllowedPushEndpoint(json.endpoint) || !p256dh || !auth) {
    await sub.unsubscribe().catch(() => false);
    throw new PushEndpointRefused('endpoint');
  }
  const r = await client().from('push_subscriptions').upsert(
    {
      endpoint: json.endpoint,
      p256dh,
      auth,
      device: deviceName(),
      disabled_at: null,
      failures: 0,
      last_error: null,
    },
    { onConflict: 'endpoint' },
  );
  if (r.error) throw new Error(`push_subscriptions: ${r.error.message}`);
}

export async function removeDevice(row: PushDeviceRow, thisEndpoint: string | null): Promise<void> {
  const r = await client().from('push_subscriptions').delete().eq('id', row.id);
  if (r.error) throw new Error(`push_subscriptions: ${r.error.message}`);
  if (thisEndpoint !== null && row.endpoint === thisEndpoint) {
    const sub = await currentSubscription().catch(() => null);
    await sub?.unsubscribe().catch(() => false);
  }
}
