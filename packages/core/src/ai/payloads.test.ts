import { describe, expect, it } from 'vitest';
import type { FinancialSummary, Metric, QuarterRow } from '../fundamentals.js';
import type { JournalTrade } from '../journal.js';
import { weeklyReviewFacts, type WeeklyInputs } from '../weekly-review.js';
import {
  DOC_CHAR_LIMIT,
  citationsFor,
  contentKey,
  filingPayload,
  weeklyPayload,
  type FilingSources,
} from './payloads.js';
import { factsTemplate } from './template.js';
import { verifyText } from './verify.js';

const m = (value: number | null, derived = false): Metric => ({
  value,
  filed: '2026-08-27',
  accession: '0001045810-26-000101',
  derived,
});

// NVIDIA's Q2 FY2027 (quarter ended 2026-07-26), as the SEC job stores it (fixtures/sec), rounded where shown.
const quarter: QuarterRow = {
  end: '2026-07-26',
  revenue: m(46_743_000_000),
  grossProfit: m(33_853_000_000),
  operatingIncome: m(28_440_000_000),
  netIncome: m(26_422_000_000),
  epsDiluted: m(1.08),
  grossMarginPct: 72.42,
  operatingMarginPct: 60.84,
  netMarginPct: 56.53,
  revenueYoYPct: 55.6,
};
const financials = {
  asOf: '2026-11-30',
  formulaVersion: 'fundamentals-1',
  latest: { end: '2026-07-26', filed: '2026-08-27' },
  quarters: [quarter],
  annual: [],
  ttm: null,
  balance: null,
} as FinancialSummary;

const src: FilingSources = {
  ticker: 'NVDA',
  cik: '0001045810',
  financials,
  annual: {
    periodEnd: '2026-01-25',
    filingDate: '2026-02-25',
    url: 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000021/nvda-20260125.htm',
    text: 'Item 1A. Risk Factors. '.repeat(1500),
  },
  quarterly: {
    accession: '0001045810-26-000101',
    periodEnd: '2026-07-26',
    filingDate: '2026-08-27',
    url: 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000101/nvda-20260726.htm',
    text: 'There have been no material changes to our risk factors.',
    noMaterialChanges: true,
  },
  eightKs: [
    {
      accession: '0001045810-26-000120',
      filingDate: '2026-11-19',
      items: ['2.02', '9.01'],
      url: null,
    },
    { accession: '0001045810-26-000050', filingDate: '2026-05-01', items: ['5.02'], url: null },
  ],
  today: '2026-11-30',
};

describe('filing payload (ai-payload-1)', () => {
  const b = filingPayload(src, 'filing-summary@1');
  if (!b) throw new Error('expected a payload');

  it('gives every figure, date and form item an id, and the template built from it verifies', () => {
    expect(b.payload.facts.map((f) => f.id)).toEqual(b.payload.facts.map((_f, i) => `F${i + 1}`));
    expect(b.payload.documents.map((d) => d.id)).toEqual(['D1', 'D2']);
    expect(verifyText(factsTemplate(b.payload), b.payload).issues).toEqual([]);
  });

  it('a sentence a model would write from it verifies, with dates and item numbers as written in the facts', () => {
    const rev = b.payload.facts.find((f) => f.label.startsWith('Revenue,'))!;
    const yoy = b.payload.facts.find((f) => f.label.startsWith('Revenue change'))!;
    const eightK = b.payload.facts.find((f) => f.label.startsWith('8-K'))!;
    const text = `Revenue was $46.74B in the quarter ended 2026-07-26 [${rev.id}]. Revenue rose 55.6% from a year earlier [${yoy.id}]. An 8-K filed on 2026-11-19 reported results under item 2.02 [${eightK.id}]. The 10-Q says the risk factors did not change materially [D1].`;
    expect(verifyText(text, b.payload).issues).toEqual([]);
  });

  it('cuts long filing text and says so in the title', () => {
    const tenK = b.payload.documents.find((d) => d.title.startsWith('10-K'))!;
    expect(tenK.text).toHaveLength(DOC_CHAR_LIMIT);
    expect(tenK.title).toBe(
      `10-K risk factors (Item 1A), first ${DOC_CHAR_LIMIT} characters of ${src.annual!.text.length}`,
    );
    expect(b.payload.documents.find((d) => d.title.startsWith('10-Q'))!.title).toBe(
      '10-Q risk factors (Part II, Item 1A)',
    );
  });

  it('keeps 8-Ks of the last 120 days only, and links each to its filing index', () => {
    expect(b.sourceIds).toEqual([
      'xbrl:0001045810-26-000101:2026-07-26',
      '10q:0001045810-26-000101',
      '10k:2026-01-25:2026-02-25',
      '8k:0001045810-26-000120',
    ]);
    const ref = b.refs.find((r) => r.label.startsWith('8-K'))!;
    expect(ref.url).toBe(
      'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000120/0001045810-26-000120-index.htm',
    );
    expect(ref.label).toContain('item 2.02 (');
  });

  it('the source key changes with a new filing or a new prompt version, not otherwise', () => {
    expect(filingPayload(src, 'filing-summary@1')!.sourceKey).toBe(b.sourceKey);
    expect(filingPayload(src, 'filing-summary@2')!.sourceKey).not.toBe(b.sourceKey);
    expect(filingPayload(src, 'thesis-draft@1')!.sourceKey).not.toBe(b.sourceKey);
    const newer = {
      ...src,
      eightKs: [
        ...src.eightKs,
        { accession: '0001045810-26-000130', filingDate: '2026-11-28', items: ['8.01'], url: null },
      ],
    };
    expect(filingPayload(newer, 'filing-summary@1')!.sourceKey).not.toBe(b.sourceKey);
    expect(b.sourceKey).toMatch(/^[0-9a-f]{16}$/);
  });

  it('says what is missing instead of inventing it, and returns null with nothing stored', () => {
    const bare = filingPayload(
      { ...src, financials: null, annual: null, eightKs: [] },
      'filing-summary@1',
    )!;
    expect(bare.notes).toEqual([
      'No quarterly figures stored',
      'No 10-K risk factor section stored',
      'No 8-K in the last 120 days',
    ]);
    expect(
      filingPayload(
        { ...src, financials: null, annual: null, quarterly: null, eightKs: [] },
        'filing-summary@1',
      ),
    ).toBeNull();
  });

  it('citationsFor keeps the cited ids in order and drops unknown ones', () => {
    expect(citationsFor(b.refs, ['D1', 'F1', 'X9']).map((r) => r.id)).toEqual(['D1', 'F1']);
  });

  it('contentKey is stable FNV-1a 64-bit (hand-checked: the empty string is the offset basis)', () => {
    expect(contentKey([''])).toBe('cbf29ce484222325');
    expect(contentKey(['a'])).toBe('af63dc4c8601ec8c');
  });
});

const trade = (over: Partial<JournalTrade>): JournalTrade => ({
  id: 1,
  ticker: 'NVDA',
  side: 'long',
  setup: 'breakout',
  tags: [],
  alertId: null,
  entryDate: '2026-11-24',
  entryPrice: 100,
  shares: 10,
  stop: 95,
  target: 120,
  exitDate: '2026-11-27',
  exitPrice: 110,
  checklist: {},
  checklistVersion: 'checklist-1',
  followed: {},
  notes: '',
  screenshots: [],
  ...over,
});

describe('weekly review facts: the template numbers, as citable facts', () => {
  const inputs: WeeklyInputs = {
    weekEnding: '2026-11-29',
    trades: [trade({}), trade({ id: 2, exitPrice: 97 })],
    alerts: [{ kind: 'halt', decision: 'push' }],
    feedback: [],
    scorecard: [],
    regime: 'stress',
  };
  const facts = weeklyReviewFacts(inputs);

  it('computes closed, winners, realized result and mean R by hand', () => {
    const by = (start: string) => facts.find((f) => f.label.startsWith(start))?.value;
    expect(by('Week ending 2026-11-29: trades closed')).toBe(2);
    expect(by('Closed trades that made money')).toBe(1);
    // +100 and -30 realized.
    expect(by('Realized result')).toBe(70);
    // +2R and -0.6R: mean 0.7R.
    expect(by('Mean result in R')).toBe(0.7);
    expect(by("Market regime at the week's end")).toBe('stress');
  });

  it('prose written from them verifies, and the template from them does too', () => {
    const p = weeklyPayload(inputs, 'weekly-review@1');
    const id = (start: string) => facts.find((f) => f.label.startsWith(start))!.id;
    const prose = `You closed 2 trades this week [${id('Week ending')}]. The closed trades made $70.00 [${id('Realized result')}]. The mean result was 0.7R [${id('Mean result in R')}].`;
    expect(verifyText(prose, p.payload).issues).toEqual([]);
    expect(verifyText(factsTemplate(p.payload), p.payload).issues).toEqual([]);
    expect(p.sourceKey).toBe(weeklyPayload(inputs, 'weekly-review@1').sourceKey);
  });
});
