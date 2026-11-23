import { describe, expect, it } from 'vitest';
import {
  HttpClient,
  TokenBucket,
  TtlCache,
  classifyFailure,
  type Clock,
  type FetchLike,
  type FetchResponse,
} from './http.js';

/** A fake clock whose sleep advances time instantly. */
function fakeClock(start = 1_000_000): Clock & { slept: number[]; t: number } {
  const c = {
    t: start,
    slept: [] as number[],
    now: () => c.t,
    sleep: (ms: number) => {
      c.slept.push(ms);
      c.t += ms;
      return Promise.resolve();
    },
  };
  return c;
}

const res = (status: number, body = '', headers: Record<string, string> = {}): FetchResponse => ({
  status,
  headers: { get: (n) => headers[n.toLowerCase()] ?? null },
  text: () => Promise.resolve(body),
});

function scripted(responses: (FetchResponse | Error)[]): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  const fetch: FetchLike = (url) => {
    calls.push(url);
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r as FetchResponse);
  };
  return { fetch, calls };
}

function client(
  responses: (FetchResponse | Error)[],
  opts: { capacity?: number; perSec?: number } = {},
) {
  const clock = fakeClock();
  const s = scripted(responses);
  const http = new HttpClient({
    fetch: s.fetch,
    clock,
    bucket: new TokenBucket(opts.capacity ?? 100, opts.perSec ?? 100, clock),
    cache: new TtlCache<string>(),
    baseDelayMs: 100,
    random: () => 0,
  });
  return { http, clock, calls: s.calls };
}

describe('TokenBucket (the free tier allows about 5 calls a minute)', () => {
  it('lets a burst through, then spaces calls 12 seconds apart', async () => {
    const clock = fakeClock();
    const bucket = new TokenBucket(5, 5 / 60, clock);
    for (let i = 0; i < 5; i += 1) expect(await bucket.take()).toBe(0);
    expect(await bucket.take()).toBe(12_000);
    expect(await bucket.take()).toBe(12_000);
  });
  it('refills over time up to capacity', async () => {
    const clock = fakeClock();
    const bucket = new TokenBucket(2, 1, clock);
    await bucket.take();
    await bucket.take();
    clock.t += 10_000;
    expect(await bucket.take()).toBe(0);
    expect(await bucket.take()).toBe(0);
    expect(await bucket.take()).toBe(1000);
  });
});

describe('TtlCache', () => {
  it('expires entries and evicts the oldest when full', () => {
    const c = new TtlCache<string>(2);
    c.set('a', '1', 1000, 0);
    c.set('b', '2', 1000, 0);
    c.set('c', '3', 1000, 0);
    expect(c.get('a', 1)).toBeUndefined();
    expect(c.get('b', 1)).toBe('2');
    expect(c.get('b', 1000)).toBeUndefined();
  });
});

describe('classifyFailure', () => {
  it('detects an entitlement error and does not call it an outage', () => {
    // Synthetic body in the documented Polygon-lineage shape, not a recorded Massive response.
    const body = JSON.stringify({
      status: 'NOT_AUTHORIZED',
      message: 'You are not entitled to this data.',
    });
    expect(classifyFailure(403, body).kind).toBe('not-entitled');
    expect(classifyFailure(403, 'Warning [NOT_ENTITLED]: This data is not included').kind).toBe(
      'not-entitled',
    );
  });
  it('separates auth, rate limit, not found and server errors', () => {
    expect(classifyFailure(401, '{"status":"ERROR","message":"Unknown API Key"}').kind).toBe(
      'auth-failed',
    );
    expect(classifyFailure(429, '').kind).toBe('rate-limited');
    expect(classifyFailure(404, '').kind).toBe('not-found');
    expect(classifyFailure(503, '').kind).toBe('server-error');
    expect(classifyFailure(400, 'bad').kind).toBe('client-error');
  });
});

describe('HttpClient', () => {
  it('returns a success with latency and attempt count', async () => {
    const { http, calls } = client([res(200, '{"ok":1}')]);
    const r = await http.get('https://x/y');
    expect(r).toMatchObject({ ok: true, body: '{"ok":1}', attempts: 1, fromCache: false });
    expect(calls).toHaveLength(1);
  });
  it('serves repeats from the cache without a second request', async () => {
    const { http, calls } = client([res(200, 'A'), res(200, 'B')]);
    await http.get('https://x/y', { cacheTtlMs: 60_000 });
    const second = await http.get('https://x/y', { cacheTtlMs: 60_000 });
    expect(second).toMatchObject({ ok: true, body: 'A', fromCache: true, attempts: 0 });
    expect(calls).toHaveLength(1);
  });
  it('retries server errors with exponential backoff, then succeeds', async () => {
    const { http, clock } = client([res(503), res(502), res(200, 'ok')]);
    const r = await http.get('https://x/y');
    expect(r).toMatchObject({ ok: true, attempts: 3 });
    expect(clock.slept).toEqual([100, 200]);
  });
  it('honours Retry-After on a 429', async () => {
    const { http, clock } = client([res(429, '', { 'retry-after': '7' }), res(200, 'ok')]);
    await http.get('https://x/y');
    expect(clock.slept).toEqual([7000]);
  });
  it('never retries an entitlement error', async () => {
    const body = JSON.stringify({
      status: 'NOT_AUTHORIZED',
      message: 'You are not entitled to this data.',
    });
    const { http, calls } = client([res(403, body), res(200, 'should not be reached')]);
    const r = await http.get('https://x/y');
    expect(r).toMatchObject({ ok: false, kind: 'not-entitled', status: 403, attempts: 1 });
    expect(calls).toHaveLength(1);
  });
  it('gives up after the retry budget and reports the last failure', async () => {
    const { http, calls } = client([res(500)]);
    const r = await http.get('https://x/y');
    expect(r).toMatchObject({ ok: false, kind: 'server-error', attempts: 4 });
    expect(calls).toHaveLength(4);
  });
  it('retries network errors', async () => {
    const { http } = client([new Error('socket hang up'), res(200, 'ok')]);
    expect(await http.get('https://x/y')).toMatchObject({ ok: true, attempts: 2 });
  });
  it('respects the rate limiter between calls', async () => {
    const clock = fakeClock();
    const s = scripted([res(200, 'a')]);
    const http = new HttpClient({
      fetch: s.fetch,
      clock,
      bucket: new TokenBucket(1, 1 / 12, clock),
    });
    await http.get('https://x/1');
    await http.get('https://x/2');
    expect(clock.slept).toEqual([12_000]);
  });
});
