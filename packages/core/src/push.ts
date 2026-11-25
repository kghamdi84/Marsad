/**
 * Web Push messages (push-1, ADR 0031). Pure: the dispatcher job encrypts and sends; the browser subscribes.
 * Title at most 60 and body at most 140 characters (the brief's limits). A message that waited longer than its
 * limit is not sent at all, and one sent late says how late, so an old alert never arrives looking current.
 */
import { clip } from './briefs.js';

export const PUSH_VERSION = 'push-1';

export type PushUrgency = 'high' | 'normal' | 'low';

export interface PushMessage {
  title: string;
  body: string;
  /** Same-origin path the notification opens. */
  url: string;
  /** Replaces an earlier notification with the same tag instead of stacking a duplicate. */
  tag: string;
  urgency: PushUrgency;
  /** How long the push service may hold the message for an offline device. */
  ttlSeconds: number;
}

// The same pattern the database checks (migration 20261218000000): https, a known push host, then a path. No
// port, user name or other host can match, because only letters, digits, hyphens and dots may precede the path.
const ENDPOINT =
  /^https:\/\/([A-Za-z0-9-]+\.)*(push\.apple\.com|fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com)\//;

export function isAllowedPushEndpoint(endpoint: string): boolean {
  return endpoint.length <= 1000 && ENDPOINT.test(endpoint);
}

/** How long each kind of message may wait before it is dropped instead of sent. */
export const PUSH_MAX_AGE_SECONDS = {
  critical: 2 * 3600,
  high: 2 * 3600,
  normal: 6 * 3600,
  system: 2 * 3600,
  brief: 3 * 3600,
} as const;

/** A message sent this many seconds or more after its event says so in the body. */
export const PUSH_LATE_SECONDS = 600;

const urgencyOf = (priority: string): PushUrgency =>
  priority === 'critical' || priority === 'high' ? 'high' : 'normal';

/** Whole minutes between the event and now, for the late prefix. */
function lateBody(body: string, ageSeconds: number): string {
  if (ageSeconds < PUSH_LATE_SECONDS) return clip(body, 140);
  const minutes = Math.floor(ageSeconds / 60);
  const lag = minutes < 120 ? `${minutes} min` : `${Math.floor(minutes / 60)} h`;
  return clip(`Sent ${lag} late. ${body}`, 140);
}

export type PushItem =
  | {
      type: 'alert';
      id: string;
      priority: 'critical' | 'high' | 'normal' | 'digest';
      title: string;
      body: string;
      createdAt: string;
    }
  | {
      type: 'system';
      id: string;
      event: 'stale' | 'recovered' | 'mismatch';
      headline: string;
      createdAt: string;
    }
  | { type: 'brief'; id: string; kind: string; title: string; body: string; createdAt: string };

export type PushPlan =
  { send: true; message: PushMessage } | { send: false; reason: string; delivery: string };

const SYSTEM_TITLE: Record<'stale' | 'recovered' | 'mismatch', string> = {
  stale: 'Marsad system: feed stale',
  recovered: 'Marsad system: feed recovered',
  mismatch: 'Marsad system: sources disagree',
};

/** Decides whether an item is still worth pushing and builds its message. */
export function planPush(item: PushItem, now: Date): PushPlan {
  const ageSeconds = Math.max(0, (now.getTime() - Date.parse(item.createdAt)) / 1000);
  if (!Number.isFinite(ageSeconds))
    return { send: false, reason: 'no valid time', delivery: 'not sent (no valid time)' };
  if (item.type === 'alert' && item.priority === 'digest')
    return { send: false, reason: 'digest priority', delivery: 'not sent (digest)' };
  const limit =
    item.type === 'alert'
      ? PUSH_MAX_AGE_SECONDS[item.priority as 'critical' | 'high' | 'normal']
      : item.type === 'system'
        ? PUSH_MAX_AGE_SECONDS.system
        : PUSH_MAX_AGE_SECONDS.brief;
  if (ageSeconds > limit) {
    const hours = Math.round((limit / 3600) * 10) / 10;
    return {
      send: false,
      reason: `older than ${hours} h`,
      delivery: `expired (not sent within ${hours} h)`,
    };
  }
  switch (item.type) {
    case 'alert':
      return {
        send: true,
        message: {
          title: clip(item.title, 60),
          body: lateBody(item.body, ageSeconds),
          url: `/alerts#alert-${item.id}`,
          tag: `alert-${item.id}`,
          urgency: urgencyOf(item.priority),
          ttlSeconds: Math.max(60, Math.round(limit - ageSeconds)),
        },
      };
    case 'system':
      return {
        send: true,
        message: {
          title: SYSTEM_TITLE[item.event],
          body: lateBody(item.headline, ageSeconds),
          url: '/status',
          tag: `system-${item.id}`,
          urgency: item.event === 'recovered' ? 'normal' : 'high',
          ttlSeconds: Math.max(60, Math.round(limit - ageSeconds)),
        },
      };
    case 'brief':
      return {
        send: true,
        message: {
          title: clip(item.title, 60),
          body: lateBody(item.body, ageSeconds),
          url: item.kind === 'weekly-review' ? '/journal' : '/',
          tag: `brief-${item.id}`,
          urgency: 'normal',
          ttlSeconds: Math.max(60, Math.round(limit - ageSeconds)),
        },
      };
  }
}

/** The JSON the service worker reads; only these fields, so the worker never renders anything else. */
export function pushPayload(m: PushMessage): string {
  return JSON.stringify({ title: m.title, body: m.body, url: m.url, tag: m.tag });
}

/** Base64url without padding (RFC 4648 section 5), for keys exchanged with the browser's PushManager. */
export function toBase64Url(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += alphabet.charAt((n >> 18) & 63) + alphabet.charAt((n >> 12) & 63);
    if (b !== undefined) out += alphabet.charAt((n >> 6) & 63);
    if (c !== undefined) out += alphabet.charAt(n & 63);
  }
  return out;
}

export function fromBase64Url(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) throw new Error('not base64url');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of s) {
    buf = ((buf << 6) | alphabet.indexOf(ch)) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

/** An uncompressed P-256 public key (65 bytes, 0x04 prefix) as the browser's applicationServerKey expects. */
export function isVapidPublicKey(s: string): boolean {
  try {
    const b = fromBase64Url(s);
    return b.length === 65 && b[0] === 4;
  } catch {
    return false;
  }
}
