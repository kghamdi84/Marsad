/**
 * HTTP resilience shared by every data-source adapter: a token-bucket rate limiter,
 * a TTL cache, retry with exponential backoff (honouring Retry-After), and
 * classification of failures so a missing plan entitlement is never retried and is
 * reported as "requires plan" rather than as an outage.
 *
 * Nothing here touches a runtime API: `fetch`, the clock, sleeping and randomness are
 * injected, so the same code runs in Edge Functions, Node jobs and tests.
 */

export interface Clock {
  /** Epoch milliseconds. */
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface FetchResponse {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<FetchResponse>;

/** Allows bursts up to `capacity`, then `refillPerSecond` requests per second. */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly clock: Clock,
  ) {
    if (capacity < 1 || refillPerSecond <= 0) throw new RangeError('invalid token bucket');
    this.tokens = capacity;
    this.last = clock.now();
  }

  private refill(): void {
    const now = this.clock.now();
    this.tokens = Math.min(
      this.capacity,
      this.tokens + ((now - this.last) / 1000) * this.refillPerSecond,
    );
    this.last = now;
  }

  /** Waits until a token is available, then takes it. Returns the milliseconds waited. */
  async take(): Promise<number> {
    let waited = 0;
    for (;;) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return waited;
      }
      const wait = Math.ceil(((1 - this.tokens) / this.refillPerSecond) * 1000);
      await this.clock.sleep(wait);
      waited += wait;
    }
  }
}

/** Small bounded cache with per-entry expiry. */
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();

  constructor(private readonly maxEntries = 500) {}

  get(key: string, nowMs: number): V | undefined {
    const e = this.entries.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= nowMs) {
      this.entries.delete(key);
      return undefined;
    }
    return e.value;
  }

  set(key: string, value: V, ttlMs: number, nowMs: number): void {
    if (this.entries.size >= this.maxEntries && !this.entries.has(key)) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expiresAt: nowMs + ttlMs });
  }
}

export type FailureKind =
  | 'not-entitled' // the plan does not include this data: show "requires plan", never retry
  | 'auth-failed' // bad or missing key
  | 'rate-limited'
  | 'not-found'
  | 'server-error'
  | 'client-error'
  | 'network';

export type HttpResult =
  | {
      ok: true;
      status: number;
      body: string;
      fromCache: boolean;
      attempts: number;
      latencyMs: number;
    }
  | { ok: false; kind: FailureKind; status: number | null; message: string; attempts: number };

/**
 * Classifies a non-2xx response from Massive. Entitlement errors arrive as HTTP 403 whose JSON has
 * status "NOT_AUTHORIZED" and a message saying the user is not entitled. This shape follows the
 * documented behaviour of the API's lineage (Polygon.io); it has NOT yet been captured from a live
 * Massive REST call, so it is treated leniently (several signals) until a key allows recording one.
 */
export function classifyFailure(
  status: number,
  bodyText: string,
): { kind: FailureKind; message: string } {
  let message = bodyText.slice(0, 200);
  let apiStatus = '';
  try {
    const j = JSON.parse(bodyText) as { status?: unknown; message?: unknown; error?: unknown };
    if (typeof j.message === 'string') message = j.message;
    else if (typeof j.error === 'string') message = j.error;
    if (typeof j.status === 'string') apiStatus = j.status;
  } catch {
    // Not JSON: keep the raw excerpt.
  }
  const entitled = /not[\s_]*(entitled|authorized)/i;
  if (status === 403 || status === 401) {
    if (apiStatus === 'NOT_AUTHORIZED' || entitled.test(message) || entitled.test(bodyText)) {
      return { kind: 'not-entitled', message };
    }
    return { kind: 'auth-failed', message };
  }
  if (status === 429) return { kind: 'rate-limited', message };
  if (status === 404) return { kind: 'not-found', message };
  if (status >= 500) return { kind: 'server-error', message };
  return { kind: 'client-error', message };
}

export interface HttpClientOptions {
  fetch: FetchLike;
  clock: Clock;
  bucket: TokenBucket;
  cache?: TtlCache<string>;
  maxRetries?: number; // retries after the first attempt, default 3
  baseDelayMs?: number; // default 500
  maxDelayMs?: number; // default 30000
  random?: () => number; // for jitter, default () => 0.5
  classify?: typeof classifyFailure;
}

export interface RequestOptions {
  headers?: Record<string, string>;
  /** When set, a successful response is cached and served for this many milliseconds. */
  cacheTtlMs?: number;
}

const RETRYABLE: ReadonlySet<FailureKind> = new Set(['rate-limited', 'server-error', 'network']);

export class HttpClient {
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly random: () => number;
  private readonly classify: typeof classifyFailure;

  constructor(private readonly o: HttpClientOptions) {
    this.maxRetries = o.maxRetries ?? 3;
    this.baseDelayMs = o.baseDelayMs ?? 500;
    this.maxDelayMs = o.maxDelayMs ?? 30_000;
    this.random = o.random ?? (() => 0.5);
    this.classify = o.classify ?? classifyFailure;
  }

  async get(url: string, req: RequestOptions = {}): Promise<HttpResult> {
    const { clock, cache } = this.o;
    const cached = req.cacheTtlMs && cache ? cache.get(url, clock.now()) : undefined;
    if (cached !== undefined) {
      return { ok: true, status: 200, body: cached, fromCache: true, attempts: 0, latencyMs: 0 };
    }
    let last: HttpResult = {
      ok: false,
      kind: 'network',
      status: null,
      message: 'no attempt made',
      attempts: 0,
    };
    for (let attempt = 1; attempt <= this.maxRetries + 1; attempt += 1) {
      await this.o.bucket.take();
      const started = clock.now();
      let retryAfterMs: number | null = null;
      try {
        const init = req.headers ? { headers: req.headers } : undefined;
        const res = await this.o.fetch(url, init);
        const body = await res.text();
        const latencyMs = clock.now() - started;
        if (res.status >= 200 && res.status < 300) {
          if (req.cacheTtlMs && cache) cache.set(url, body, req.cacheTtlMs, clock.now());
          return {
            ok: true,
            status: res.status,
            body,
            fromCache: false,
            attempts: attempt,
            latencyMs,
          };
        }
        const c = this.classify(res.status, body);
        last = {
          ok: false,
          kind: c.kind,
          status: res.status,
          message: c.message,
          attempts: attempt,
        };
        const ra = Number(res.headers.get('retry-after'));
        if (Number.isFinite(ra) && ra > 0) retryAfterMs = ra * 1000;
      } catch (e) {
        last = {
          ok: false,
          kind: 'network',
          status: null,
          message: e instanceof Error ? e.message : String(e),
          attempts: attempt,
        };
      }
      if (!last.ok && !RETRYABLE.has(last.kind)) return last;
      if (attempt > this.maxRetries) break;
      const backoff = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** (attempt - 1));
      const delay =
        retryAfterMs ?? Math.min(this.maxDelayMs, backoff + this.random() * this.baseDelayMs);
      await clock.sleep(delay);
    }
    return last;
  }
}
