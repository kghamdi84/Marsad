import { describe, expect, it } from 'vitest';
import recorded from '../../../../fixtures/tauric/quotes-2026-11-26.json';
import upcoming from '../../../../fixtures/massive/market-status-upcoming.json';
import { buildCalendar, type UpcomingRow } from '../calendar.js';
import { DEFAULT_SOURCE_POLICIES } from '../health.js';
import { HttpClient, TokenBucket, type Clock, type FetchLike } from '../http.js';
import { reconcileSessionClose } from '../reconcile.js';
import {
  classifyTauricFailure,
  fetchTauricQuotes,
  notCoveredTickers,
  parseTauricQuotes,
  quoteFreshness,
  type TauricQuote,
} from './tauric.js';

const cal = buildCalendar(upcoming.data as UpcomingRow[], 'NYSE');

describe('parseTauricQuotes (recorded answer, 2026-11-26)', () => {
  const parsed = parseTauricQuotes(recorded.body);

  it('reads every stock quote with its session, previous close and change', () => {
    expect(parsed?.quotes.map((q) => q.ticker)).toEqual(['AAPL', 'NVDA', 'SPY']);
    expect(parsed?.quotes[0]).toEqual({
      ticker: 'AAPL',
      price: 355.58,
      priceTime: '2026-11-25T21:00:02.000Z',
      vendorRefreshedAt: '2026-11-26T14:10:52.060Z',
      quoteKind: 'snapshot',
      sessionDate: '2026-11-25',
      previousClose: 354.07,
      previousCloseDate: '2026-11-24',
      change: 0.004265,
      dayVolume: 53060252,
      marketState: 'closed',
    });
    // The vendor's percent becomes a fraction: -3.913% is -0.03913.
    expect(parsed?.quotes[1]?.change).toBeCloseTo(-0.03913, 10);
  });

  it('lists what it did not read: the FX pair (not a security) and the vendor error', () => {
    expect(parsed?.missing).toEqual([
      { key: 'fx:EURUSD', code: 'not-a-security' },
      { key: 'crypto:BTC-USD', code: 'not_registered' },
    ]);
  });

  it('refuses an envelope without the documented arrays, and a quote without a usable price', () => {
    expect(parseTauricQuotes({ data: [] })).toBeNull();
    expect(parseTauricQuotes('nope')).toBeNull();
    const r = parseTauricQuotes({
      data: [
        { key: 'security:AAPL', quote_kind: 'snapshot', price: null },
        { key: 'security:bad ticker!', quote_kind: 'snapshot', price: 10 },
        { key: 'security:MSFT', quote_kind: 'made_up', price: 10 },
      ],
      errors: [],
    });
    expect(r?.quotes).toEqual([]);
    expect(r?.missing.map((m) => m.code)).toEqual(['no-price', 'unreadable', 'unreadable']);
  });
});

describe('quoteFreshness: Marsad judges age by its own clock, never the vendor flag', () => {
  const base = { quoteKind: 'snapshot' as const, sessionDate: '2026-11-24' };

  it('a fresh snapshot of unconfirmed delay is never called live', () => {
    const f = quoteFreshness(
      { ...base, priceTime: '2026-11-24T15:00:00Z' },
      new Date('2026-11-24T15:03:00Z'),
      cal,
    );
    expect(f.state).toBe('delayed');
    expect(f.label).toBe('Delay not confirmed');
  });

  it('the recorded FX case: what the vendor called 5 seconds old was 30 minutes old by the time it was read', () => {
    // Vendor said price_age_seconds 5, stale false. Read at 14:41 UTC during a session, it is stale.
    const f = quoteFreshness(
      { ...base, priceTime: '2026-11-24T14:10:47Z' },
      new Date('2026-11-24T14:41:22Z'),
      cal,
    );
    expect(f.state).toBe('stale');
    expect(f.label).toBe('Stale, 30m 35s old');
  });

  it('a last_close quote is end-of-day data', () => {
    const f = quoteFreshness(
      { quoteKind: 'last_close', priceTime: null, sessionDate: '2026-11-25' },
      new Date('2026-11-26T15:00:00Z'), // Thanksgiving: Wednesday is the last completed session
      cal,
    );
    expect(f.state).toBe('live');
    expect(f.label).toBe('End of day, 2026-11-25');
  });

  it('no price time is unavailable, not calm', () => {
    expect(quoteFreshness({ ...base, priceTime: null }, new Date(), cal).state).toBe('unavailable');
  });
});

describe('classifyTauricFailure', () => {
  const body = (code: string) => JSON.stringify({ error: { code, message: `m ${code}` } });
  it('maps the documented codes', () => {
    expect(classifyTauricFailure(401, body('invalid_api_key')).kind).toBe('auth-failed');
    expect(classifyTauricFailure(403, body('entitlement_required')).kind).toBe('not-entitled');
    expect(classifyTauricFailure(429, body('rate_limit_exceeded')).kind).toBe('rate-limited');
    expect(classifyTauricFailure(503, body('temporarily_unavailable')).kind).toBe('server-error');
    expect(classifyTauricFailure(404, 'not json').kind).toBe('not-found');
  });
  it('does not retry a spent daily quota (its Retry-After can be hours)', () => {
    const c = classifyTauricFailure(429, body('quota_exhausted'));
    expect(c.kind).toBe('client-error');
    expect(c.message).toBe('daily quota exhausted: m quota_exhausted');
  });
});

describe('fetchTauricQuotes', () => {
  const clock: Clock = { now: () => 0, sleep: () => Promise.resolve() };
  function http(status: number, text: string, seen: Parameters<FetchLike>[] = []) {
    const fetch: FetchLike = (...args) => {
      seen.push(args);
      return Promise.resolve({
        status,
        headers: { get: () => null },
        text: () => Promise.resolve(text),
      });
    };
    return new HttpClient({
      fetch,
      clock,
      bucket: new TokenBucket(10, 10, clock),
      classify: classifyTauricFailure,
      maxRetries: 0,
    });
  }
  const cfg = { apiKey: 'test-key', now: () => new Date('2026-11-26T14:41:22Z') };

  it('posts one batch with the key in the header and returns quotes with provenance', async () => {
    const seen: Parameters<FetchLike>[] = [];
    const r = await fetchTauricQuotes(http(200, JSON.stringify(recorded.body), seen), cfg, [
      'AAPL',
      'NVDA',
    ]);
    expect(seen[0]?.[0]).toBe('https://api.tauric.ai/v1/quotes');
    expect(seen[0]?.[1]).toMatchObject({
      method: 'POST',
      body: '{"instruments":["security:AAPL","security:NVDA"]}',
      headers: { Authorization: 'Bearer test-key' },
    });
    expect(r.ok && r.data.provenance).toEqual({
      source: 'tauric',
      endpoint: 'POST /v1/quotes',
      asOf: '2026-11-25T21:00:02.000Z',
      fetchedAt: '2026-11-26T14:41:22.000Z',
      planTier: 'unknown',
    });
  });

  it('refuses an empty or oversized batch without calling the vendor', async () => {
    const seen: Parameters<FetchLike>[] = [];
    const many = Array.from({ length: 51 }, (_, i) => `T${i}`);
    expect((await fetchTauricQuotes(http(200, '{}', seen), cfg, [])).ok).toBe(false);
    expect((await fetchTauricQuotes(http(200, '{}', seen), cfg, many)).ok).toBe(false);
    expect(seen).toHaveLength(0);
  });

  it('says the key was rejected, in words the Status page can show', async () => {
    const r = await fetchTauricQuotes(
      http(401, JSON.stringify({ error: { code: 'invalid_api_key', message: 'bad key' } })),
      cfg,
      ['AAPL'],
    );
    expect(r.ok ? null : r.display).toBe('Tauric rejected the API key');
  });
});

describe('reconcileSessionClose (Tauric against Massive, recorded 2026-11-25 session)', () => {
  const q = (t: string) =>
    parseTauricQuotes(recorded.body)?.quotes.find((x) => x.ticker === t) as TauricQuote;

  it('AAPL agrees: same close to the cent; volume 2.3% lower is reported, not failed', () => {
    // Massive grouped daily 2026-11-25 (read through the Massive connector on 2026-11-26): close 355.58, volume 54,285,255.
    const r = reconcileSessionClose('AAPL', q('AAPL'), {
      date: '2026-11-25',
      close: 355.58,
      volume: 54285255,
    });
    expect([r.check.name, r.check.ok]).toEqual(['AAPL close 2026-11-25', true]);
    expect(r.volumeGap).toBe(-0.0226); // 53,060,252 / 54,285,255 - 1
  });

  it('the live run of 2026-11-26: DIA volume 10.3% lower with the close equal is no failure', () => {
    // Tauric DIA 501.27, volume 4,234,967; Massive DIA 501.27, volume 4,721,531 (both 2026-11-25).
    const r = reconcileSessionClose(
      'DIA',
      { sessionDate: '2026-11-25', price: 501.27, dayVolume: 4234967 },
      { date: '2026-11-25', close: 501.27, volume: 4721531 },
    );
    expect(r.check.ok).toBe(true);
    expect(r.volumeGap).toBe(-0.1031);
  });

  it('a close 10 cents apart fails: the allowance is the larger of 1 cent and 0.05% (7.5 cents here)', () => {
    const { check } = reconcileSessionClose('NVDA', q('NVDA'), {
      date: '2026-11-25',
      close: 149.4,
      volume: 366571890,
    });
    // 0.05% of 149.40 is 0.0747: the larger allowance. 0.10 apart is outside it.
    expect(check.tolerance).toBeCloseTo(0.0747, 4);
    expect(check.ok).toBe(false);
  });

  it('different sessions are a failure, never a silent skip', () => {
    const { check, volumeGap } = reconcileSessionClose('SPY', q('SPY'), {
      date: '2026-11-24',
      close: 718.78,
      volume: 1,
    });
    expect(check.ok).toBe(false);
    expect(check.detail).toBe('sessions differ: Tauric 2026-11-25, Massive 2026-11-24');
    expect(volumeGap).toBeNull();
    expect(reconcileSessionClose('SPY', q('SPY'), null).check.detail).toBe(
      'Massive has no daily bar, cannot verify',
    );
  });
});

describe('notCoveredTickers', () => {
  it('names the tickers Tauric does not carry, not a quote missing for another reason', () => {
    expect(
      notCoveredTickers([
        { key: 'security:MARA', code: 'not_registered' },
        { key: 'security:XYZ', code: 'not_supported' },
        { key: 'security:OLD', code: 'delisted' },
        { key: 'security:NVDA', code: 'temporarily_unavailable' },
        { key: 'security:AAPL', code: 'no-price' },
        { key: 'crypto:BTC-USD', code: 'not_registered' },
      ]),
    ).toEqual(['MARA', 'XYZ', 'OLD']);
  });
});

describe('Tauric health policy', () => {
  it('pauses no rule (display only) and is judged only in the regular session', () => {
    const p = DEFAULT_SOURCE_POLICIES.find((x) => x.source === 'tauric');
    expect(p?.dependentRules).toEqual([]);
    expect(p?.maxSilenceSec).toEqual({
      'pre-market': null,
      regular: 1800,
      'after-hours': null,
      closed: null,
    });
  });
});
