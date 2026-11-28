import { describe, expect, it } from 'vitest';
import { parseThesisDraft } from '@marsad/core';
import { fakeAiStore, fakeClient, json, type FakeReply } from './ai-fakes.js';
import { parseRequested, runAiThesisJob } from './ai-thesis-job.js';

const NOW = new Date('2026-11-30T00:55:00Z');

// Fact ids as the payload builder gives them for the fake NVDA filings (see ai-summaries-job.test.ts).
const DRAFT =
  'Bull case: revenue was $46.74B in the quarter ended 2026-07-26 [F3], up 55.6% from a year earlier [F4]. ' +
  'Bear case: the 10-Q repeats the annual risk factors [D1], so concentration in a few large customers remains, and net income of $26.42B [F5] depends on data-center spending that can slow. ' +
  'Key risks: customer concentration [D1]. Export limits named in the filings [D1]. ' +
  'What would change the view: a new 10-Q that reports material changes to the risk factors [F7].';
const NO_BEAR =
  'Bull case: revenue was $46.74B [F3]. Key risks: customer concentration [D1]. What would change the view: a revenue fall [F3].';

async function go(replies: FakeReply[], opts: { theses?: string[]; requested?: string[] } = {}) {
  const f = fakeAiStore(undefined, opts.theses ?? []);
  const client = fakeClient(replies);
  const run = await runAiThesisJob({
    store: f.store,
    client,
    now: () => NOW,
    ...(opts.requested ? { requested: opts.requested } : {}),
  });
  return { ...f, client, run };
}

describe('ai-thesis-drafts job (offline, fake client)', () => {
  it('without the key: skipped (not configured), nothing spent or stored', async () => {
    const f = fakeAiStore();
    const run = await runAiThesisJob({ store: f.store, client: null, now: () => NOW });
    expect(run.status).toBe('skipped');
    expect(run.details['skipped']).toBe('not configured (ANTHROPIC_API_KEY secret missing)');
    expect(f.outputs).toEqual([]);
    expect(f.usage).toEqual([]);
  });

  it('drafts a card for a holding without a thesis; the draft parses into the four parts', async () => {
    const { outputs, run, client } = await go([{ text: json(DRAFT) }]);
    expect(client.requests).toHaveLength(1);
    expect(client.requests[0]!.model).toBe('claude-sonnet-5-5');
    expect(client.requests[0]!.output_config?.effort).toBe('medium');
    expect(outputs[0]).toMatchObject({
      kind: 'thesis-draft',
      ticker: 'NVDA',
      prompt_id: 'thesis-draft',
      source: 'model',
      verified: true,
    });
    const parts = parseThesisDraft(outputs[0]!.text)!;
    expect(parts.bear.length).toBeGreaterThanOrEqual(40);
    expect(parts.risks).toEqual(['customer concentration', 'Export limits named in the filings']);
    expect(run.details).toMatchObject({ holdingsWithoutThesis: 1, requested: 0, verified: 1 });
  });

  it('a draft without a bear case is regenerated with the problem listed, then the template is stored', async () => {
    const { outputs, client } = await go([{ text: json(NO_BEAR) }, { text: json(NO_BEAR) }]);
    expect(String(client.requests[1]!.messages[0]!.content)).toContain(
      '- Missing section "Bear case:"',
    );
    expect(outputs[0]).toMatchObject({
      source: 'template',
      fallback_reason: 'verification-failed',
    });
  });

  it('a holding that already has a thesis is not drafted, unless asked for', async () => {
    const skipped = await go([{ text: json(DRAFT) }], { theses: ['NVDA'] });
    expect(skipped.client.requests).toHaveLength(0);
    const asked = await go([{ text: json(DRAFT) }], { theses: ['NVDA'], requested: ['NVDA'] });
    expect(asked.client.requests).toHaveLength(1);
    expect(asked.run.details).toMatchObject({ requested: 1, holdingsWithoutThesis: 0 });
  });

  it('a request drafts again even when the sources are unchanged', async () => {
    const f = fakeAiStore();
    const client = fakeClient([{ text: json(DRAFT) }, { text: json(DRAFT) }]);
    await runAiThesisJob({ store: f.store, client, now: () => NOW });
    await runAiThesisJob({ store: f.store, client, now: () => NOW });
    expect(client.requests).toHaveLength(1);
    await runAiThesisJob({ store: f.store, client, now: () => NOW, requested: ['nvda'] });
    expect(client.requests).toHaveLength(2);
  });

  it('parses the workflow input into valid tickers', () => {
    expect(parseRequested(' nvda, RKLB  bad$ ,NVDA')).toEqual(['NVDA', 'RKLB']);
    expect(parseRequested(undefined)).toEqual([]);
  });
});
