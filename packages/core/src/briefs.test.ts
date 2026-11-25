import { describe, expect, it } from 'vitest';
import { clip, closeRecap, preMarketBrief, type BriefInputs } from './briefs.js';

const inputs: BriefInputs = {
  date: '2026-11-25',
  regime: { date: '2026-11-24', label: 'stress', recession: 'elevated' },
  fearGreed: { date: '2026-11-24', composite: 41.88, label: 'fear', available: 5 },
  capitulation: { date: '2026-11-24', state: 'off' },
  vix: { date: '2026-11-24', value: 26.62 },
  vix3m: { date: '2026-11-24', value: 25.5 },
  breadth: { date: '2026-11-24', pctAbove50: 38.25, pctAbove200: 52.1 },
  events: [
    { date: '2026-11-25', timeEt: '08:30', name: 'GDP', impact: 'high' },
    { date: '2026-11-25', timeEt: '08:30', name: 'Jobless claims', impact: 'medium' },
    { date: '2026-11-25', timeEt: '08:30', name: 'PCE and personal income', impact: 'high' },
  ],
  earnings: [{ ticker: 'HIMS', date: '2026-11-30' }],
  watchlist: [
    { ticker: 'NVDA', date: '2026-11-24', change1d: 0.0412 },
    { ticker: 'RKLB', date: '2026-11-24', change1d: -0.0835 },
    { ticker: 'SPY', date: '2026-11-24', change1d: 0.0047 },
    { ticker: 'NEWCO', date: '2026-11-24', change1d: null },
  ],
  topic: { name: 'Tariffs and trade', last7: 28, ratio: 4 },
  staleSources: [],
};

describe('preMarketBrief (hand-checked text)', () => {
  const b = preMarketBrief(inputs);

  it('has a short title and a push body within 140 characters', () => {
    expect(b.title).toBe('Pre-market brief, Wed 2026-11-25');
    expect(b.pushBody).toBe(
      'Regime Stress. VIX 26.6. F&G 42. Today: GDP 08:30 ET, PCE and personal income 08:30 ET.',
    );
    expect(b.pushBody.length).toBeLessThanOrEqual(140);
  });

  it('states every number from the inputs, with dates', () => {
    expect(b.sections[0]?.lines).toEqual([
      'Regime: Stress; recession filter elevated (as of 2026-11-24).',
      'VIX 26.62, VIX over VIX3M 1.04 (2026-11-24).', // 26.62 / 25.5 = 1.0439
      'Fear and Greed composite 42, fear (5 of 7 components, 2026-11-24).',
      'Marsad universe above its 50-day average: 38.3%; above the 200-day: 52.1% (2026-11-24).',
    ]);
    expect(b.sections[1]?.lines).toEqual([
      '08:30 ET GDP (high impact).',
      '08:30 ET Jobless claims.',
      '08:30 ET PCE and personal income (high impact).',
    ]);
    // Largest moves first; a ticker without a change is left out.
    expect(b.sections[2]?.lines).toEqual(['RKLB -8.4%, NVDA +4.1%, SPY +0.5% (2026-11-24).']);
    expect(b.sections[3]?.lines).toEqual([
      'Estimated earnings this week: HIMS around 2026-11-30 (estimates, not confirmed).',
      'News: Tariffs and trade coverage is 4.0 times its usual level (28 articles in 7 days).',
      'System health: all sources current.',
    ]);
  });

  it('says "unavailable" instead of inventing numbers', () => {
    const b2 = preMarketBrief({
      ...inputs,
      regime: null,
      vix: null,
      fearGreed: null,
      breadth: null,
      events: [],
      watchlist: [],
      topic: null,
      earnings: [],
      staleSources: ['massive_breadth', 'fred'],
    });
    expect(b2.sections[0]?.lines).toEqual([
      'Regime: not computed.',
      'VIX: data unavailable.',
      'Fear and Greed composite: not enough components yet.',
    ]);
    expect(b2.pushBody).toBe('No high-impact data today. 2 source(s) stale.');
    expect(b2.sections[3]?.lines).toEqual([
      'System health: stale or unavailable: massive_breadth, fred.',
    ]);
  });

  it('flags the capitulation watch when it is on', () => {
    const b3 = preMarketBrief({ ...inputs, capitulation: { date: '2026-11-24', state: 'on' } });
    expect(b3.sections[0]?.lines.at(-1)).toContain('Capitulation watch is ON');
  });

  it('never uses an em dash', () => {
    expect(JSON.stringify(b)).not.toMatch(/—/);
  });
});

describe('closeRecap', () => {
  it('leads with the watchlist day in the push', () => {
    const r = closeRecap(inputs);
    expect(r.title).toBe('Close recap, Wed 2026-11-25');
    expect(r.pushBody).toBe(
      'Regime Stress. VIX 26.6. Watchlist: RKLB -8.4%, NVDA +4.1%, SPY +0.5% (2026-11-24).',
    );
    expect(r.sections.map((s) => s.heading)).toEqual([
      'Market state',
      'Watchlist today',
      'Next session (ET)',
      'Ahead and health',
    ]);
  });
});

describe('clip', () => {
  it('cuts at a word and ends with a full stop', () => {
    expect(clip('one two three four five six seven eight nine ten', 30)).toBe(
      'one two three four five six.',
    );
    expect(clip('short', 30)).toBe('short');
    expect(clip('x'.repeat(200), 140)).toHaveLength(140);
  });
});
