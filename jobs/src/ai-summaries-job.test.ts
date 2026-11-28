import { describe, expect, it } from 'vitest';
import { NVDA_10Q_ACCESSION, fakeAiStore, fakeClient, json, type FakeReply } from './ai-fakes.js';
import { runAiSummariesJob } from './ai-summaries-job.js';

const NOW = new Date('2026-11-30T00:50:00Z');
const ACC = NVDA_10Q_ACCESSION;

/** The ids the payload gives NVDA's facts, in builder order (see ai/payloads.ts; no EPS stored, so the 8-K is F8). */
const ID = {
  quarterEnd: 'F1',
  revenue: 'F3',
  yoy: 'F4',
  eightK: 'F8',
} as const;

const GOOD = `Revenue was $46.74B in the quarter ended 2026-07-26 [${ID.revenue}]. Revenue rose 55.6% from a year earlier [${ID.yoy}]. The 10-Q reports no material change to the risk factors [D1]. An 8-K filed on 2026-11-19 reported quarterly results [${ID.eightK}].`;
const WRONG = `Revenue was $48.10B in the quarter [${ID.revenue}].`;

async function go(replies: FakeReply[], spent?: { dailyUsd: number; monthlyUsd: number }) {
  const f = fakeAiStore(spent);
  const client = fakeClient(replies);
  const run = await runAiSummariesJob({
    store: f.store,
    client,
    now: () => NOW,
    randomHex: () => 'fedcba9876543210',
  });
  return { ...f, client, run };
}

describe('ai-summaries job (offline, fake client)', () => {
  it('without the key: skipped (not configured), never ok, nothing spent or stored', async () => {
    const f = fakeAiStore();
    const run = await runAiSummariesJob({ store: f.store, client: null, now: () => NOW });
    expect(run.status).toBe('skipped');
    expect(run.details).toEqual({
      calls: 0,
      usd: 0,
      skipped: 'not configured (ANTHROPIC_API_KEY secret missing)',
    });
    expect(f.usage).toEqual([]);
    expect(f.outputs).toEqual([]);
    expect(f.runs).toHaveLength(1);
  });

  it('a verified summary is stored with its citations, prompt, model and input snapshot', async () => {
    const { run, outputs, usage, client } = await go([{ text: json(GOOD) }]);
    expect(run.status).toBe('ok');
    // NVDA once (holding and watchlist); RKLB has no CIK stored, so no data.
    expect(client.requests).toHaveLength(1);
    expect(outputs).toHaveLength(1);
    const o = outputs[0]!;
    expect(o).toMatchObject({
      kind: 'filing-summary',
      ticker: 'NVDA',
      for_date: null,
      prompt_id: 'filing-summary',
      prompt_version: 1,
      model: 'claude-sonnet-5-5',
      served_model: 'claude-sonnet-5-5',
      text: GOOD,
      verified: true,
      source: 'model',
      fallback_reason: null,
      attempts: 1,
    });
    expect(o.citations.map((c) => c.id)).toEqual([ID.revenue, ID.yoy, 'D1', ID.eightK]);
    expect(o.citations.find((c) => c.id === 'D1')).toMatchObject({
      kind: 'document',
      url: 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000101/nvda-20260726.htm',
      asOf: '2026-08-27',
    });
    expect(o.source_ids).toEqual([
      `xbrl:${ACC}:2026-07-26`,
      `10q:${ACC}`,
      '8k:0001045810-26-000120',
    ]);
    expect(o.input_snapshot).toMatchObject({
      payloadVersion: 'ai-payload-1',
      prompt: 'filing-summary@1',
    });
    expect(usage).toHaveLength(1);
    expect(run.details).toMatchObject({
      tickers: 2,
      written: 1,
      verified: 1,
      noData: 1,
      calls: 1,
      budget: { state: 'ok' },
      warnings: [],
    });
  });

  it('an unchanged source is not summarized again', async () => {
    const f = fakeAiStore();
    const client = fakeClient([{ text: json(GOOD) }, { text: json(GOOD) }]);
    await runAiSummariesJob({ store: f.store, client, now: () => NOW });
    const second = await runAiSummariesJob({ store: f.store, client, now: () => NOW });
    expect(client.requests).toHaveLength(1);
    expect(second.details).toMatchObject({ written: 0, unchanged: 1, calls: 0 });
  });

  it('a wrong number is regenerated once; wrong again, the template is stored with the reason', async () => {
    const { outputs, client } = await go([{ text: json(WRONG) }, { text: json(WRONG) }]);
    expect(client.requests).toHaveLength(2);
    expect(outputs[0]).toMatchObject({
      source: 'template',
      fallback_reason: 'verification-failed',
      verified: true,
      served_model: null,
      attempts: 2,
    });
    expect(outputs[0]!.failures).toHaveLength(2);
    expect(outputs[0]!.failures[0]).toMatchObject({ kind: 'verification', rejectedText: WRONG });
    // The template lists every fact, so it cites them all.
    expect(outputs[0]!.text).toContain(
      `Revenue, quarter ended 2026-07-26: $46.74B [${ID.revenue}].`,
    );
  });

  it('a refusal stores the template with reason refusal after one call', async () => {
    const { outputs, client, run } = await go([{ stop: 'refusal' }]);
    expect(client.requests).toHaveLength(1);
    expect(outputs[0]).toMatchObject({ source: 'template', fallback_reason: 'refusal' });
    expect(run.details).toMatchObject({ templates: { refusal: 1 } });
  });

  it('at the cap no call is made: the template is stored once, then not again while capped', async () => {
    const f = fakeAiStore({ dailyUsd: 1, monthlyUsd: 1 });
    const client = fakeClient([{ text: json(GOOD) }]);
    const first = await runAiSummariesJob({ store: f.store, client, now: () => NOW });
    expect(client.requests).toHaveLength(0);
    expect(f.outputs[0]).toMatchObject({
      source: 'template',
      fallback_reason: 'cost-cap',
      attempts: 0,
    });
    expect(first.details).toMatchObject({
      templates: { 'cost-cap': 1 },
      budget: { state: 'capped', message: 'AI cap reached (daily): text falls back to templates' },
    });
    const second = await runAiSummariesJob({ store: f.store, client, now: () => NOW });
    expect(f.outputs).toHaveLength(1);
    expect(second.details).toMatchObject({ deferred: 1, written: 0 });
  });

  it('at 80% of a cap it still writes, and the warning is in the run details', async () => {
    const { run } = await go([{ text: json(GOOD) }], { dailyUsd: 0.85, monthlyUsd: 2 });
    expect(run.details).toMatchObject({ verified: 1, warnings: ['AI spend at 85% of a cap'] });
  });

  it('a max_tokens stop is retried once', async () => {
    const { outputs } = await go([{ stop: 'max_tokens' }, { text: json(GOOD) }]);
    expect(outputs[0]).toMatchObject({ source: 'model', attempts: 2 });
  });
});
