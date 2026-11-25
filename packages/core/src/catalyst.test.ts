import { describe, expect, it } from 'vitest';
import { DEFAULT_ALERT_SETTINGS, renderCard, runPipeline } from './alerts.js';
import {
  catalystAlert,
  isConfirmed,
  matchScenario,
  type CatalystEvent,
  type CatalystScenario,
  type SessionMove,
} from './catalyst.js';

// The brief's example scenario, written in advance.
const scenario: CatalystScenario = {
  id: 7,
  name: 'NVDA CEO returns',
  tickers: ['NVDA'],
  keywords: ['ceo'],
  triggers: {
    eightKItems: ['5.02'],
    form4Codes: [],
    newsMinTier: 2,
    halts: true,
    movePct: null,
    volumeRatio: null,
  },
  plan: {
    entry: 'Watch for a first 5-minute range break that holds VWAP.',
    chaseGuardPct: 0.1,
    invalidation: 'Below the pre-market low.',
    size: 'half the usual risk.',
  },
  expiresOn: '2026-12-31',
};
const TODAY = '2026-11-24';
const NOW = new Date('2026-11-24T22:45:00Z');
const eightK: CatalystEvent = {
  kind: '8-K',
  ticker: 'NVDA',
  at: '2026-11-24T21:30:00Z',
  items: ['5.02', '9.01'],
  accession: '0001045810-26-000099',
};
const news = (publisher: string, title: string, id: string): CatalystEvent => ({
  kind: 'news',
  tickers: ['NVDA'],
  at: '2026-11-24T20:00:00Z',
  title,
  publisher,
  id,
});
const move = (close: number): SessionMove => ({
  ticker: 'NVDA',
  date: TODAY,
  prevClose: 100,
  close,
  volumeRatio: 3,
});

describe('confirmation rule', () => {
  it('tier 1, or two tier-2 sources from different publishers', () => {
    const s = (tier: 1 | 2 | 3, publisher: string) => ({ label: '', tier, at: '', publisher });
    expect(isConfirmed([s(1, 'sec')])).toBe(true);
    expect(isConfirmed([s(2, 'reuters'), s(2, 'bloomberg')])).toBe(true);
    expect(isConfirmed([s(2, 'reuters'), s(2, 'reuters')])).toBe(false); // one wire twice
    expect(isConfirmed([s(2, 'reuters'), s(3, 'benzinga')])).toBe(false);
  });
});

describe('matchScenario', () => {
  it('an 8-K with item 5.02 matches and is confirmed (tier 1)', () => {
    const [m] = matchScenario(scenario, [eightK], [move(127)], TODAY);
    expect(m).toMatchObject({ ticker: 'NVDA', confirmed: true, triggers: ['8-K item 5.02'] });
  });

  it('news must name a keyword and meet the minimum tier; two wires confirm, one does not', () => {
    const one = matchScenario(scenario, [news('Reuters', 'Nvidia CEO returns', 'n1')], [], TODAY);
    expect(one[0]?.confirmed).toBe(false);
    const two = matchScenario(
      scenario,
      [
        news('Reuters', 'Nvidia CEO returns', 'n1'),
        news('Bloomberg', 'CEO back at Nvidia', 'n2'),
        news('Benzinga', 'CEO news lifts Nvidia', 'n3'), // tier 3: below the scenario's minimum tier
        news('Reuters', 'Nvidia earnings preview', 'n4'), // no keyword
      ],
      [],
      TODAY,
    );
    expect(two[0]?.confirmed).toBe(true);
    expect(two[0]?.triggers).toEqual(['News: Nvidia CEO returns', 'News: CEO back at Nvidia']);
  });

  it('no trigger, another ticker, or an expired scenario: no match', () => {
    expect(matchScenario(scenario, [{ ...eightK, items: ['8.01'] }], [], TODAY)).toEqual([]);
    expect(matchScenario(scenario, [{ ...eightK, ticker: 'AMD' }], [], TODAY)).toEqual([]);
    expect(matchScenario(scenario, [eightK], [], '2027-01-01')).toEqual([]);
  });

  it('a price-and-volume trigger needs both the move and the volume', () => {
    const priced = {
      ...scenario,
      triggers: { ...scenario.triggers, movePct: 0.08, volumeRatio: 2 },
    };
    expect(matchScenario(priced, [], [move(109)], TODAY)[0]?.triggers).toEqual([
      'Moved +9.0% on 2026-11-24 at 3.0x average volume',
    ]);
    expect(matchScenario(priced, [], [{ ...move(109), volumeRatio: 1.5 }], TODAY)).toEqual([]);
    expect(matchScenario(priced, [], [move(105)], TODAY)).toEqual([]);
  });
});

describe('catalystAlert', () => {
  it('applies the chase guard in the plan: a 27% gap above a 10% guard means no entry', () => {
    const [m] = matchScenario(scenario, [eightK], [move(127)], TODAY);
    if (!m) throw new Error('no match');
    const a = catalystAlert(m, { regime: 'stress' }, { label: '8-K item 5.02 filings', n: 6 }, NOW);
    expect(a).toMatchObject({
      kind: 'catalyst',
      priority: 'critical',
      ruleStatus: 'shadow',
      headline: 'NVDA: scenario "NVDA CEO returns" matched',
      eventId: 'catalyst:7:NVDA:2026-11-24',
    });
    expect(a.plan?.entry).toBe(
      'No entry: the +27.0% move is beyond the 10.0% chase guard. Planned entry otherwise: Watch for a first 5-minute range break that holds VWAP.',
    );
    expect(a.bearCase).toContain('Only 6 comparable past 8-K item 5.02 filings stored');
    const card = renderCard(a);
    expect(card.find((s) => s.heading === 'Plan')?.lines).toEqual([
      `Entry: ${a.plan?.entry}`,
      'Invalidation: Below the pre-market low. Size: half the usual risk.',
    ]);
  });

  it('an unconfirmed match is high priority and says so; the pipeline records it as shadow', () => {
    const [m] = matchScenario(scenario, [news('Reuters', 'Nvidia CEO returns', 'n1')], [], TODAY);
    if (!m) throw new Error('no match');
    const a = catalystAlert(m, {}, { label: 'news matches', n: 0 }, NOW);
    expect(a.priority).toBe('high');
    expect(a.headline).toContain('(unconfirmed)');
    expect(a.trigger).toContain('Unconfirmed: no tier-1 source');
    const r = runPipeline(a, DEFAULT_ALERT_SETTINGS, { recent: [], pushesToday: 0 }, NOW);
    expect(r.decision).toBe('shadow');
  });
});
