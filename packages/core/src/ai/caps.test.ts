import { describe, expect, it } from 'vitest';
import {
  AI_CAPS,
  AI_CAPS_APPROVED_ON,
  costOfResponse,
  costOfUsage,
  effectiveCaps,
  estimateCallUsd,
  priceOf,
} from './cost.js';
import type { Payload } from './facts.js';
import { StopGeneration, groundedGenerate } from './grounded.js';
import { factsTemplate } from './template.js';
import {
  GROUNDED_TEXT_SCHEMA,
  parseGroundedText,
  parseThesisDraft,
  stripCitations,
} from '../prompts/formats.js';
import { thesisDraftPrompt } from '../prompts/catalog.js';

const zero = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

describe("Khaled's approved caps (ADR 0007 addendum, 2026-11-28)", () => {
  it('are USD 1 a day and USD 10 a month, written once', () => {
    expect(AI_CAPS).toEqual({ dailyUsd: 1, monthlyUsd: 10 });
    expect(AI_CAPS_APPROVED_ON).toBe('2026-11-28');
    expect(Object.isFrozen(AI_CAPS)).toBe(true);
  });
  it('a saved cap can lower them, never raise them; blank or invalid keeps the approved cap', () => {
    expect(effectiveCaps(null)).toEqual({ dailyUsd: 1, monthlyUsd: 10 });
    expect(effectiveCaps({ dailyUsd: null, monthlyUsd: null })).toEqual(AI_CAPS);
    expect(effectiveCaps({ dailyUsd: 0.5, monthlyUsd: 25 })).toEqual({
      dailyUsd: 0.5,
      monthlyUsd: 10,
    });
    expect(effectiveCaps({ dailyUsd: 0, monthlyUsd: Number.NaN })).toEqual(AI_CAPS);
  });
});

describe('response cost (hand-checked)', () => {
  it('prices the top-level usage at the model that served it', () => {
    // 3,000 in at $2 = 0.006; 800 out at $10 = 0.008.
    const u = { ...zero, inputTokens: 3_000, outputTokens: 800 };
    expect(costOfResponse('claude-sonnet-5-5', u)).toBeCloseTo(0.014, 12);
    expect(costOfResponse('claude-sonnet-5-5', u)).toBe(costOfUsage('claude-sonnet-5-5', u));
  });
  it('prices each iteration of a server-side fallback at its own model', () => {
    // Declined Opus 5.5 iteration: 2,000 in at $4 = 0.008, 100 out at $20 = 0.002.
    // Fallback Opus 5 iteration: 2,000 in at $5 = 0.010, 500 out at $25 = 0.0125. Total 0.0325.
    const usd = costOfResponse('claude-opus-5', zero, [
      { ...zero, model: 'claude-opus-5-5', inputTokens: 2_000, outputTokens: 100 },
      { ...zero, model: 'claude-opus-5', inputTokens: 2_000, outputTokens: 500 },
    ]);
    expect(usd).toBeCloseTo(0.0325, 12);
  });
  it('prices an unknown model at the dearest known price, so spend is never under-counted', () => {
    expect(priceOf('claude-unknown-9').known).toBe(false);
    expect(priceOf('claude-unknown-9').price.outputPerMTok).toBe(25);
    expect(priceOf('claude-opus-5-5')).toMatchObject({ known: true });
  });
  it('a call ceiling counts three characters a token plus every allowed output token', () => {
    // 9,000 chars = 3,000 tokens at $2 = 0.006; 8,000 out at $10 = 0.08.
    expect(estimateCallUsd('claude-sonnet-5-5', 9_000, 8_000)).toBeCloseTo(0.086, 12);
  });
});

const payload: Payload = {
  facts: [
    { id: 'F1', label: 'Revenue growth year over year', value: 12.4, unit: 'pct' },
    { id: 'F2', label: 'Change in operating margin', value: -2.5, unit: 'pct' },
  ],
  documents: [{ id: 'D1', title: '10-Q risk factors', text: 'Customer concentration.' }],
};
const template = () => factsTemplate(payload);

describe('groundedGenerate: stops, and prompt checks', () => {
  it('a refusal goes straight to the template, with no second attempt', async () => {
    let calls = 0;
    const r = await groundedGenerate({
      payload,
      template,
      generate: () => {
        calls += 1;
        return Promise.reject(new StopGeneration('refusal', 'refused (general_harms)'));
      },
    });
    expect(calls).toBe(1);
    expect(r).toMatchObject({ source: 'template', reason: 'refusal', attempts: 1 });
    expect(r.failures[0]?.details).toEqual(['refused (general_harms)']);
  });
  it('the cap reached before a call is not counted as an attempt', async () => {
    const r = await groundedGenerate({
      payload,
      template,
      generate: () => Promise.reject(new StopGeneration('cost-cap', 'AI cap reached (daily)')),
    });
    expect(r).toMatchObject({ source: 'template', reason: 'cost-cap', attempts: 0 });
  });
  it('a prompt check failing (no bear case) regenerates once with the problem listed', async () => {
    const seen: (readonly string[])[] = [];
    const good =
      'Bull case: revenue grew 12.4% [F1]. Bear case: operating margin fell 2.5% and customers are concentrated [F2, D1]. Key risks: customer concentration [D1]. What would change the view: another fall in operating margin [F2].';
    const r = await groundedGenerate({
      payload,
      template,
      check: thesisDraftPrompt.check,
      generate: (req) => {
        seen.push(req.feedback);
        return Promise.resolve(req.attempt === 1 ? 'Bull case: revenue grew 12.4% [F1].' : good);
      },
    });
    expect(seen[1]).toContain('Missing section "Bear case:"');
    expect(r).toMatchObject({ source: 'model', reason: 'verified', attempts: 2 });
  });
});

describe('structured output: one text field', () => {
  it('the schema allows only the text field', () => {
    expect(GROUNDED_TEXT_SCHEMA).toMatchObject({ required: ['text'], additionalProperties: false });
  });
  it('reads the text, and refuses anything else', () => {
    expect(parseGroundedText('{"text":" Revenue grew 12.4% [F1]. "}')).toBe(
      'Revenue grew 12.4% [F1].',
    );
    expect(parseGroundedText('{"text":""}')).toBeNull();
    expect(parseGroundedText('{"summary":"x"}')).toBeNull();
    expect(parseGroundedText('[1]')).toBeNull();
    expect(parseGroundedText('Revenue grew')).toBeNull();
  });
});

describe('thesis draft parts, for prefilling the human-edited form', () => {
  const draft =
    'Bull case: revenue grew 12.4% year over year [F1]. Bear case: operating margin fell 2.5% [F2]. Customers are concentrated [D1]. Key risks: customer concentration [D1]. Margin pressure [F2]. What would change the view: another quarter of operating margin decline [F2].';
  it('splits the four parts, removes citations, and lists each risk once', () => {
    expect(parseThesisDraft(draft)).toEqual({
      bull: 'revenue grew 12.4% year over year.',
      bear: 'operating margin fell 2.5%. Customers are concentrated.',
      risks: ['customer concentration', 'Margin pressure'],
      changeView: 'another quarter of operating margin decline.',
      citations: ['F1', 'F2', 'D1'],
    });
  });
  it('refuses a draft with a missing or misplaced label', () => {
    expect(parseThesisDraft('Bull case: x [F1].')).toBeNull();
    expect(
      parseThesisDraft('Bear case: a. Bull case: b. Key risks: c. What would change the view: d.'),
    ).toBeNull();
  });
  it('stripCitations tidies the spacing', () => {
    expect(stripCitations('Revenue grew 12.4% [F1, D2] .')).toBe('Revenue grew 12.4%.');
  });
});
