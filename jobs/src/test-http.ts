/** A test HTTP client that answers by URL fragment, for the job tests. Never used outside tests. */
import { HttpClient, TokenBucket, type Clock, type FetchLike } from '@marsad/core';

export interface Reply {
  status: number;
  body: unknown;
}

export function routedHttp(
  at: Date,
  routes: readonly (readonly [fragment: string, reply: Reply | ((url: string) => Reply)])[],
): { http: HttpClient; urls: string[] } {
  const urls: string[] = [];
  // A virtual clock: waiting (the rate limiter or a retry) moves it forward, so a long run never spins forever.
  let t = at.getTime();
  const clock: Clock = {
    now: () => t,
    sleep: (ms) => {
      t += ms;
      return Promise.resolve();
    },
  };
  const fetch: FetchLike = (url) => {
    urls.push(url);
    const hit = routes.find(([fragment]) => url.includes(fragment));
    const reply = hit
      ? typeof hit[1] === 'function'
        ? hit[1](url)
        : hit[1]
      : { status: 404, body: { status: 'NOT_FOUND' } };
    const text = typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body);
    return Promise.resolve({
      status: reply.status,
      headers: { get: () => null },
      text: () => Promise.resolve(text),
    });
  };
  return {
    http: new HttpClient({ fetch, clock, bucket: new TokenBucket(100, 100, clock), maxRetries: 0 }),
    urls,
  };
}
