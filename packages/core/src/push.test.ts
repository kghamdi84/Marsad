import { describe, expect, it } from 'vitest';
import {
  fromBase64Url,
  isAllowedPushEndpoint,
  isVapidPublicKey,
  planPush,
  pushPayload,
  toBase64Url,
  type PushItem,
} from './push.js';

const enc = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const dec = (b: Uint8Array) => String.fromCharCode(...b);
const at = (iso: string) => new Date(iso);
const T0 = '2026-11-25T15:00:00Z';

describe('base64url', () => {
  // RFC 4648 section 10 vectors, with the URL alphabet and no padding.
  const vectors: [string, string][] = [
    ['', ''],
    ['f', 'Zg'],
    ['fo', 'Zm8'],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg'],
    ['fooba', 'Zm9vYmE'],
    ['foobar', 'Zm9vYmFy'],
  ];
  it.each(vectors)('encodes %j as %j and back', (plain, b64) => {
    expect(toBase64Url(enc(plain))).toBe(b64);
    expect(dec(fromBase64Url(b64))).toBe(plain);
  });
  it('uses - and _ for the last two symbols', () => {
    expect(toBase64Url(new Uint8Array([0xfb, 0xff]))).toBe('-_8');
    expect([...fromBase64Url('-_8')]).toEqual([0xfb, 0xff]);
  });
  it('agrees with Node over random bytes', () => {
    const b = new Uint8Array(65);
    for (let i = 0; i < b.length; i++) b[i] = (i * 97 + 13) % 256;
    // Node's own base64url, computed once and pasted here as the reference.
    expect(toBase64Url(b)).toBe(
      'DW7PMJHyU7QVdtc4mfpbvB1-30ChAmPEJYbnSKkKa8wtju9QsRJz1DWW91i5GnvcPZ7_YMEig-RFpgdoySqL7E0',
    );
    expect([...fromBase64Url(toBase64Url(b))]).toEqual([...b]);
  });
  it('rejects text that is not base64url', () => {
    expect(() => fromBase64Url('ab+c')).toThrow();
    expect(() => fromBase64Url('abcde')).toThrow();
  });
});

describe('isVapidPublicKey', () => {
  it('accepts 65 bytes starting 0x04 and nothing else', () => {
    const k = new Uint8Array(65);
    k[0] = 4;
    expect(isVapidPublicKey(toBase64Url(k))).toBe(true);
    k[0] = 3;
    expect(isVapidPublicKey(toBase64Url(k))).toBe(false);
    expect(isVapidPublicKey(toBase64Url(new Uint8Array(64)))).toBe(false);
    expect(isVapidPublicKey('not a key!')).toBe(false);
  });
});

describe('isAllowedPushEndpoint', () => {
  it.each([
    'https://web.push.apple.com/QAbc123',
    'https://fcm.googleapis.com/fcm/send/abc:def',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAA',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
  ])('allows %s', (u) => expect(isAllowedPushEndpoint(u)).toBe(true));
  it.each([
    'http://web.push.apple.com/x',
    'https://web.push.apple.com:8443/x',
    'https://user:pw@web.push.apple.com/x',
    'https://evil.example/web.push.apple.com',
    'https://push.apple.com.evil.example/x',
    'https://notpush.apple.com/x',
    'https://169.254.169.254/latest',
    'https://web.push.apple.com',
    `https://web.push.apple.com/${'x'.repeat(1000)}`,
    'not a url',
  ])('refuses %s', (u) => expect(isAllowedPushEndpoint(u)).toBe(false));
});

const alert = (over: Partial<Extract<PushItem, { type: 'alert' }>> = {}): PushItem => ({
  type: 'alert',
  id: 'a1',
  priority: 'critical',
  title: '[HALT, critical] NVDA: trading halted (T1)',
  body: 'Nasdaq halt notice, reason T1 (news pending).',
  createdAt: T0,
  ...over,
});

describe('planPush', () => {
  it('sends a fresh critical alert as high urgency to its card', () => {
    const p = planPush(alert(), at('2026-11-25T15:00:30Z'));
    expect(p).toEqual({
      send: true,
      message: {
        title: '[HALT, critical] NVDA: trading halted (T1)',
        body: 'Nasdaq halt notice, reason T1 (news pending).',
        url: '/alerts#alert-a1',
        tag: 'alert-a1',
        urgency: 'high',
        ttlSeconds: 7170,
      },
    });
  });
  it('marks a message sent 10 minutes or more after the event as late, and not one at 9:59', () => {
    const late = planPush(alert(), at('2026-11-25T15:10:00Z'));
    expect(late.send && late.message.body).toBe(
      'Sent 10 min late. Nasdaq halt notice, reason T1 (news pending).',
    );
    const early = planPush(alert(), at('2026-11-25T15:09:59Z'));
    expect(early.send && early.message.body).toBe('Nasdaq halt notice, reason T1 (news pending).');
    const hours = planPush(alert({ priority: 'normal' }), at('2026-11-25T18:30:00Z'));
    expect(hours.send && hours.message.body.startsWith('Sent 3 h late.')).toBe(true);
  });
  it('drops a critical alert older than 2 hours and keeps one at exactly 2 hours', () => {
    expect(planPush(alert(), at('2026-11-25T17:00:00Z')).send).toBe(true);
    expect(planPush(alert(), at('2026-11-25T17:00:01Z'))).toEqual({
      send: false,
      reason: 'older than 2 h',
      delivery: 'expired (not sent within 2 h)',
    });
  });
  it('gives normal alerts 6 hours, normal urgency', () => {
    const p = planPush(alert({ priority: 'normal' }), at('2026-11-25T20:59:00Z'));
    expect(p.send && p.message.urgency).toBe('normal');
    expect(planPush(alert({ priority: 'normal' }), at('2026-11-25T21:00:01Z')).send).toBe(false);
  });
  it('never pushes a digest alert', () => {
    expect(planPush(alert({ priority: 'digest' }), at(T0))).toEqual({
      send: false,
      reason: 'digest priority',
      delivery: 'not sent (digest)',
    });
  });
  it('clips title to 60 and body to 140 characters, late prefix included', () => {
    const p = planPush(
      alert({ title: 'x'.repeat(80), body: 'word '.repeat(60) }),
      at('2026-11-25T15:30:00Z'),
    );
    expect(p.send && p.message.title.length).toBeLessThanOrEqual(60);
    expect(p.send && p.message.body.length).toBeLessThanOrEqual(140);
    expect(p.send && p.message.body.startsWith('Sent 30 min late.')).toBe(true);
  });
  it('sends system alerts to the Status page; recovery is normal urgency', () => {
    const stale = planPush(
      {
        type: 'system',
        id: '7',
        event: 'stale',
        headline: 'Massive bars stale since 14:00 ET',
        createdAt: T0,
      },
      at(T0),
    );
    expect(stale.send && stale.message).toMatchObject({
      title: 'Marsad system: feed stale',
      url: '/status',
      tag: 'system-7',
      urgency: 'high',
    });
    const ok = planPush(
      {
        type: 'system',
        id: '8',
        event: 'recovered',
        headline: 'Massive bars recovered',
        createdAt: T0,
      },
      at(T0),
    );
    expect(ok.send && ok.message.urgency).toBe('normal');
  });
  it('sends briefs to Watch and the weekly review to Journal, for 3 hours', () => {
    const b = {
      type: 'brief' as const,
      id: '3',
      title: 'Pre-market brief',
      body: 'SPY -0.4%',
      createdAt: T0,
    };
    const pm = planPush({ ...b, kind: 'pre-market' }, at(T0));
    expect(pm.send && pm.message.url).toBe('/');
    const wr = planPush({ ...b, kind: 'weekly-review' }, at(T0));
    expect(wr.send && wr.message.url).toBe('/journal');
    expect(planPush({ ...b, kind: 'pre-market' }, at('2026-11-25T18:00:01Z')).send).toBe(false);
  });
  it('refuses an item with no valid time', () => {
    expect(planPush(alert({ createdAt: 'yesterday' }), at(T0)).send).toBe(false);
  });
});

describe('pushPayload', () => {
  it('carries only title, body, url and tag', () => {
    const p = planPush(alert(), at(T0));
    if (!p.send) throw new Error('expected a message');
    expect(JSON.parse(pushPayload(p.message))).toEqual({
      title: p.message.title,
      body: p.message.body,
      url: '/alerts#alert-a1',
      tag: 'alert-a1',
    });
  });
});
