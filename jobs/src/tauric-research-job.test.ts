import { describe, expect, it } from 'vitest';
import nvda from '../../fixtures/tauric/research-NVDA-2026-11-28.json';
import aapl from '../../fixtures/tauric/research-AAPL-2026-11-28.json';
import bbai from '../../fixtures/tauric/research-BBAI-2026-11-28.json';
import {
  HttpClient,
  TokenBucket,
  classifyTauricFailure,
  type Clock,
  type FetchLike,
  type JobRunRecord,
  type ResearchValue,
} from '@marsad/core';
import {
  RESEARCH_CREDIT_RESERVE,
  researchTickers,
  runTauricResearchJob,
  type CompanyResearchWrite,
  type TauricResearchStore,
} from './tauric-research-job.js';

type Reply = { status: number; body: unknown };
const NOT_REGISTERED: Reply = { status: 404, body: bbai.parts.profile.body };
const account = (used: number, allowance = 3000): Reply => ({
  status: 200,
  body: {
    pools: [{ id: 'data', used, allowance, resets_at: '2026-11-29T00:00:00Z' }, { id: 'ai' }],
  },
});

/** A fake Tauric answering from the recorded fixtures by path; `override` replaces single routes. */
function server(override: Record<string, Reply> = {}, used = 10) {
  const recorded: Record<string, { parts: Record<string, { status: number; body: unknown }> }> = {
    NVDA: nvda,
    AAPL: aapl,
  };
  const calls: string[] = [];
  const fetch: FetchLike = (url) => {
    const path = new URL(url).pathname;
    calls.push(path);
    const m = /^\/v1\/securities\/([^/]+)\/(\w+)$/.exec(path);
    const reply: Reply =
      override[path] ??
      (path === '/v1/account'
        ? account(used)
        : m
          ? (recorded[m[1] ?? '']?.parts[m[2] ?? ''] ?? NOT_REGISTERED)
          : { status: 404, body: { error: { code: 'not_found', message: 'no route' } } });
    return Promise.resolve({
      status: reply.status,
      headers: { get: () => null },
      text: () => Promise.resolve(JSON.stringify(reply.body)),
    });
  };
  const at = new Date('2026-11-28T09:35:00Z');
  const clock: Clock = { now: () => at.getTime(), sleep: () => Promise.resolve() };
  const http = new HttpClient({
    fetch,
    clock,
    bucket: new TokenBucket(1000, 1000, clock),
    classify: classifyTauricFailure,
    maxRetries: 0,
  });
  return { http, calls, cfg: { apiKey: 'k', now: () => at }, now: () => at };
}

function fake(
  holdings: string[],
  watchlists: string[],
  stored: Record<string, CompanyResearchWrite> = {},
) {
  const runs: JobRunRecord[] = [];
  const rows = stored;
  const store: TauricResearchStore = {
    getHoldingTickers: () => Promise.resolve(holdings),
    getWatchlistTickers: () => Promise.resolve(watchlists),
    upsertResearch: (row) => {
      // Like PostgREST's upsert: columns sent replace, columns left out keep their value.
      rows[row.ticker] = { ...(rows[row.ticker] ?? {}), ...row };
      return Promise.resolve();
    },
    recordRun: (r) => {
      runs.push(r);
      return Promise.resolve();
    },
  };
  return { store, runs, rows };
}

describe('researchTickers', () => {
  it('puts holdings first, adds watchlists once, and drops what is not a ticker', () => {
    expect(researchTickers(['NVDA', 'rklb'], ['AAPL', 'NVDA', 'not a ticker!'])).toEqual([
      'NVDA',
      'RKLB',
      'AAPL',
    ]);
  });
});

describe('runTauricResearchJob', () => {
  it('stores all four parts for covered tickers, marks BBAI not covered, and spends one credit per 200', async () => {
    const s = server();
    const f = fake(['NVDA'], ['AAPL', 'BBAI']);
    const run = await runTauricResearchJob({ ...s, store: f.store });
    expect(run.status).toBe('ok');
    expect(run.job).toBe('tauric-research');
    expect(run.rows_written).toBe(3);
    // The account read, four parts for NVDA and AAPL, and only the profile for BBAI.
    expect(s.calls).toEqual([
      '/v1/account',
      '/v1/securities/NVDA/profile',
      '/v1/securities/NVDA/analyst',
      '/v1/securities/NVDA/thesis',
      '/v1/securities/NVDA/calendar',
      '/v1/securities/AAPL/profile',
      '/v1/securities/AAPL/analyst',
      '/v1/securities/AAPL/thesis',
      '/v1/securities/AAPL/calendar',
      '/v1/securities/BBAI/profile',
    ]);
    expect(run.details).toMatchObject({
      version: 'tauric-research-1',
      creditsSpent: 8,
      creditsBefore: 10,
      allowance: 3000,
      budget: 300,
      notCovered: ['BBAI'],
      deferred: [],
      malformed: [],
      failed: [],
      outcomes: {
        NVDA: { profile: 'ok', analyst: 'ok', thesis: 'ok', calendar: 'ok' },
        BBAI: 'not covered',
      },
    });
    const n = f.rows['NVDA']!;
    expect(n).toMatchObject({
      source: 'tauric',
      analyst_refreshed_at: '2026-11-28T01:46:14.960Z',
      profile_refreshed_at: '2026-11-28T01:46:14.960Z',
      thesis_generated_at: '2026-11-27T08:34:51.081Z',
      calendar_refreshed_at: '2026-11-28T01:46:14.960Z',
      fetched_at: '2026-11-28T09:35:00.000Z',
      errors: {},
    });
    expect(n.analyst).toMatchObject({ target_mean_price: 242.4278, ratings_total: 63 });
    expect(n.analyst).not.toHaveProperty('instrument');
    expect(n.thesis).toMatchObject({
      revision: 'rv_d59c8222206343c2',
      cutoff: '2026-11-27T08:34:25.012Z',
    });
    expect(f.rows['AAPL']?.calendar).toMatchObject({
      earnings: { earnings_date: '2027-01-28', eps_estimate: 2.9106 },
    });
    expect(f.rows['BBAI']).toMatchObject({
      analyst: null,
      profile: null,
      thesis: null,
      calendar: null,
      errors: {
        profile: 'not_registered',
        analyst: 'not_registered',
        thesis: 'not_registered',
        calendar: 'not_registered',
      },
    });
    expect(f.runs).toEqual([run]);
  });

  it('rejects a malformed part with its reason and keeps the stored value of that part', async () => {
    const bad = { ...nvda.parts.analyst.body, target_low_price: 300 };
    const s = server({ '/v1/securities/NVDA/analyst': { status: 200, body: bad } });
    const old = { target_mean_price: 200 } as unknown as ResearchValue;
    const f = fake(['NVDA'], [], {
      NVDA: {
        ticker: 'NVDA',
        source: 'tauric',
        fetched_at: '2026-11-27T09:35:00Z',
        errors: {},
        analyst: old,
        analyst_refreshed_at: '2026-11-27T01:40:00Z',
      },
    });
    const run = await runTauricResearchJob({ ...s, store: f.store });
    expect(run.status).toBe('ok');
    expect(run.details['creditsSpent']).toBe(4); // a malformed 200 is still charged
    expect(run.details['malformed']).toEqual([
      'NVDA analyst: malformed: target_low_price 300 is above target_median_price 240',
    ]);
    const n = f.rows['NVDA']!;
    expect(n.analyst).toBe(old);
    expect(n.analyst_refreshed_at).toBe('2026-11-27T01:40:00Z');
    expect(n.errors).toEqual({
      analyst: 'malformed: target_low_price 300 is above target_median_price 240',
    });
    expect(n.profile).toMatchObject({ sub_industry: 'Semiconductors' });
  });

  it('a passing outage keeps the stored part; a part Tauric does not publish is cleared', async () => {
    const s = server({
      '/v1/securities/NVDA/thesis': {
        status: 503,
        body: { error: { code: 'temporarily_unavailable', message: 'try later' } },
      },
      '/v1/securities/NVDA/calendar': {
        status: 404,
        body: { error: { code: 'not_published', message: 'none' } },
      },
    });
    const f = fake(['NVDA'], [], {
      NVDA: {
        ticker: 'NVDA',
        source: 'tauric',
        fetched_at: '2026-11-27T09:35:00Z',
        errors: {},
        thesis: { narrative: 'older' } as unknown as ResearchValue,
        calendar: { earnings: null } as unknown as ResearchValue,
      },
    });
    const run = await runTauricResearchJob({ ...s, store: f.store });
    expect(run.status).toBe('ok');
    expect(run.details['failed']).toEqual(['NVDA thesis (temporarily_unavailable)']);
    expect(f.rows['NVDA']?.thesis).toEqual({ narrative: 'older' });
    expect(f.rows['NVDA']?.calendar).toBeNull();
    expect(f.rows['NVDA']?.errors).toEqual({
      thesis: 'temporarily_unavailable',
      calendar: 'not_published',
    });
  });

  it('keeps the daily reserve: with few credits left it spends none and says why', async () => {
    const s = server({}, 3000 - RESEARCH_CREDIT_RESERVE - 2);
    const f = fake(['NVDA'], []);
    const run = await runTauricResearchJob({ ...s, store: f.store });
    expect(run.status).toBe('skipped');
    expect(run.details['skipped']).toBe(
      'daily data credits low (2698 of 3000 used, 300 kept for quotes)',
    );
    expect(s.calls).toEqual(['/v1/account']);
  });

  it('stops starting tickers at the budget, lists the rest as deferred, and warns at 80% of the day', async () => {
    // 3000 - 2392 - 300 = 308 left after the reserve, capped at 300; 2392 + 8 is over 80% (2400).
    const s = server({}, 2392);
    const f = fake(['NVDA', 'AAPL'], []);
    const run = await runTauricResearchJob({ ...s, store: f.store });
    expect(run.details).toMatchObject({ creditsSpent: 8, budget: 300, deferred: [] });
    expect(run.details['creditWarning']).toBe("Tauric data credits at 80% of today's 3000");
    const tight = server({}, 3000 - RESEARCH_CREDIT_RESERVE - 5); // a budget of 5: one ticker
    const g = fake(['NVDA', 'AAPL'], []);
    const r2 = await runTauricResearchJob({ ...tight, store: g.store });
    expect(r2.details).toMatchObject({ creditsSpent: 4, budget: 5, deferred: ['AAPL'] });
    expect(Object.keys(g.rows)).toEqual(['NVDA']);
  });

  it('a rejected key stops the run as an error, writing nothing', async () => {
    const s = server({
      '/v1/securities/NVDA/profile': {
        status: 401,
        body: { error: { code: 'invalid_api_key', message: 'bad key' } },
      },
    });
    const f = fake(['NVDA', 'AAPL'], []);
    const run = await runTauricResearchJob({ ...s, store: f.store });
    expect(run.status).toBe('error');
    expect(run.error).toBe(
      'Tauric research stopped at NVDA profile: Tauric rejected the API key (auth-failed)',
    );
    expect(f.rows).toEqual({});
    expect(f.runs).toHaveLength(1);
  });

  it('is an error when nothing could be stored, and skips when there are no tickers', async () => {
    const down: Reply = {
      status: 503,
      body: { error: { code: 'temporarily_unavailable', message: 'down' } },
    };
    const s = server(
      Object.fromEntries(
        ['profile', 'analyst', 'thesis', 'calendar'].map((p) => [`/v1/securities/NVDA/${p}`, down]),
      ),
    );
    const f = fake(['NVDA'], []);
    const run = await runTauricResearchJob({ ...s, store: f.store });
    expect(run.status).toBe('error');
    expect(run.error).toMatch(/^No research part stored: NVDA profile \(temporarily_unavailable\)/);
    const empty = await runTauricResearchJob({ ...server(), store: fake([], []).store });
    expect(empty.status).toBe('skipped');
  });
});
