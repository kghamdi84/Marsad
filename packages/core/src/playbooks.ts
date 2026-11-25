/**
 * The seeded playbook library (ADR 0018): the brief's eleven playbooks with evidence ratings, sources and horizons,
 * and a `rule-dsl-1` document where daily bars can express the playbook. Every playbook starts as a draft and earns
 * live status only through Marsad's own tests (McLean and Pontiff, 2016: published anomalies weaken).
 */
import type { RuleDoc } from './rules.js';

export type Rating = 'strong' | 'moderate' | 'weak' | 'weak-to-moderate';
export type Horizon = 'scalp' | 'swing' | 'swing-to-long' | 'long';

export interface Playbook {
  id: string;
  number: number;
  title: string;
  horizon: Horizon;
  rating: Rating;
  sources: string[];
  /** What the playbook does, in one or two sentences. */
  summary: string;
  /** The testable rule, or null with the reason it cannot be expressed yet. */
  rule: RuleDoc | null;
  notTestableBecause: string | null;
  /** Tickers the runner tests the rule on (stored daily bars). */
  testOn: string[];
}

const above = (period: number) =>
  ({ left: { ind: 'close' }, op: '>', right: { ind: 'sma', period } }) as const;

export const PLAYBOOKS: readonly Playbook[] = [
  {
    id: 'index-trend-filter',
    number: 1,
    title: 'Index core with a trend filter',
    horizon: 'long',
    rating: 'moderate',
    sources: [
      'Faber, "A Quantitative Approach to Tactical Asset Allocation" (2007)',
      'Malkiel, A Random Walk Down Wall Street',
      'Ilmanen, Expected Returns',
    ],
    summary:
      'Hold the index while it closes above its 200-day average; step aside when it closes below.',
    rule: {
      id: 'index-trend-filter',
      name: 'Index above its 200-day average',
      side: 'long',
      entry: { left: { ind: 'close' }, op: 'crossesAbove', right: { ind: 'sma', period: 200 } },
      exit: { left: { ind: 'close' }, op: 'crossesBelow', right: { ind: 'sma', period: 200 } },
    },
    notTestableBecause: null,
    testOn: ['SPY', 'QQQ', 'IWM', 'DIA'],
  },
  {
    id: 'dual-momentum',
    number: 2,
    title: 'Dual momentum rotation',
    horizon: 'long',
    rating: 'moderate',
    sources: ['Antonacci, Dual Momentum Investing (2014)'],
    summary:
      'Relative plus absolute 12-month momentum across US equities, international equities and bonds.',
    rule: null,
    notTestableBecause:
      'Needs ranking across assets (relative momentum), which rule-dsl-1 cannot express, and international equity and bond bars that are not stored yet.',
    testOn: [],
  },
  {
    id: 'etf-time-series-momentum',
    number: 3,
    title: 'Sector and ETF momentum (time-series part)',
    horizon: 'swing-to-long',
    rating: 'strong',
    sources: [
      'Jegadeesh and Titman, Journal of Finance (1993)',
      'Moskowitz, Ooi and Pedersen, "Time Series Momentum", Journal of Financial Economics (2012)',
      'Gray and Vogel, Quantitative Momentum',
    ],
    summary:
      'Own an ETF while its 12-month return is positive. The cross-sectional part (owning the strongest sectors) needs ranking and comes with rule-dsl-2.',
    rule: {
      id: 'etf-time-series-momentum',
      name: 'ETF with a positive 12-month return',
      side: 'long',
      entry: { left: { ind: 'return', period: 252 }, op: 'crossesAbove', right: 0 },
      exit: { left: { ind: 'return', period: 252 }, op: 'crossesBelow', right: 0 },
    },
    notTestableBecause: null,
    testOn: ['SPY', 'QQQ', 'IWM', 'DIA', 'GLD', 'ITA', 'IYT'],
  },
  {
    id: 'stock-to-etf-rotation',
    number: 4,
    title: 'Stock-to-ETF rotation',
    horizon: 'long',
    rating: 'moderate',
    sources: [
      'Built on playbook 3 and the quality literature (Novy-Marx 2013; Asness, Frazzini and Pedersen 2019)',
    ],
    summary: 'Exit lagging single names with weakening theses into the sector ETF or index.',
    rule: null,
    notTestableBecause:
      'Compares a stock with its sector ETF and its thesis; needs holdings (Phase 6) and two-ticker rules.',
    testOn: [],
  },
  {
    id: 'quality-at-discount',
    number: 5,
    title: 'Quality at a discount',
    horizon: 'long',
    rating: 'moderate',
    sources: [
      'Graham, The Intelligent Investor',
      'Novy-Marx, "The Other Side of Value", Journal of Financial Economics (2013)',
      'Asness, Frazzini and Pedersen, "Quality Minus Junk", Review of Accounting Studies (2019)',
    ],
    summary:
      'Buy profitable, conservatively financed companies when they are cheap, activated by the capitulation watch.',
    rule: null,
    notTestableBecause:
      'Needs point-in-time fundamentals screening across the universe (a later batch).',
    testOn: [],
  },
  {
    id: 'trend-template-breakout',
    number: 6,
    title: 'Swing breakouts in leading stocks (trend template)',
    horizon: 'swing',
    rating: 'weak-to-moderate',
    sources: ["O'Neil, How to Make Money in Stocks", 'Minervini, Trade Like a Stock Market Wizard'],
    summary:
      'Price above rising 50-, 150- and 200-day averages and within 25% of the 52-week high; exit below the 50-day average or at an 8% stop. Test before trusting.',
    rule: {
      id: 'trend-template-breakout',
      name: 'Trend template with an 8% stop',
      side: 'long',
      entry: {
        all: [
          above(50),
          { left: { ind: 'sma', period: 50 }, op: '>', right: { ind: 'sma', period: 150 } },
          { left: { ind: 'sma', period: 150 }, op: '>', right: { ind: 'sma', period: 200 } },
          {
            left: { ind: 'sma', period: 200 },
            op: '>',
            right: { ind: 'sma', period: 200, offset: 20 },
          },
          {
            left: { ind: 'close' },
            op: '>=',
            right: { ind: 'mul', left: 0.75, right: { ind: 'highest', period: 252, of: 'close' } },
          },
          {
            left: { ind: 'close' },
            op: '>=',
            right: { ind: 'highest', period: 20, of: 'close', offset: 1 },
          },
        ],
      },
      exit: { left: { ind: 'close' }, op: '<', right: { ind: 'sma', period: 50 } },
      stop: { pct: 0.08 },
    },
    notTestableBecause: null,
    testOn: ['NVDA', 'RKLB', 'MARA', 'SOFI', 'HOOD', 'OKLO', 'IONQ', 'HIMS', 'RGTI', 'BBAI'],
  },
  {
    id: 'post-earnings-drift',
    number: 7,
    title: 'Post-earnings announcement drift',
    horizon: 'swing',
    rating: 'moderate',
    sources: ['Bernard and Thomas, Journal of Accounting Research (1989)'],
    summary:
      'Follow the direction of a large earnings surprise for weeks after it. Weaker in recent large-cap data.',
    rule: null,
    notTestableBecause:
      'Needs earnings surprises (consensus estimates are not on the current plan).',
    testOn: [],
  },
  {
    id: 'insider-cluster-buying',
    number: 8,
    title: 'Insider cluster buying',
    horizon: 'long',
    rating: 'moderate',
    sources: [
      'Lakonishok and Lee, Review of Financial Studies (2001)',
      'Cohen, Malloy and Pomorski, "Decoding Inside Information", Journal of Finance (2012)',
    ],
    summary:
      'Three or more insiders buying in the open market within 30 days, excluding 10b5-1 plan trades.',
    rule: null,
    notTestableBecause: 'Needs Form 4 events in the rule language (stored already; rule-dsl-2).',
    testOn: [],
  },
  {
    id: 'volatility-aware-options',
    number: 9,
    title: 'Volatility-aware options',
    horizon: 'swing',
    rating: 'moderate',
    sources: [
      'Natenberg, Option Volatility and Pricing',
      'McMillan, Options as a Strategic Investment',
    ],
    summary:
      'Buy premium when IV rank is low, use defined-risk spreads when it is high, avoid long premium through earnings.',
    rule: null,
    notTestableBecause: 'Needs options data (Phase 5 plan decision).',
    testOn: [],
  },
  {
    id: 'capitulation-staging',
    number: 10,
    title: 'Capitulation staging',
    horizon: 'long',
    rating: 'moderate',
    sources: [
      'Whaley, "The Investor Fear Gauge", Journal of Portfolio Management (2000)',
      'Zweig breadth thrust (confirmation)',
    ],
    summary:
      'Staged index-ETF entries under the capitulation watch, gated by the recession filter (ADR 0011); verified with the in-app event study.',
    rule: null,
    notTestableBecause:
      'Runs from the capitulation watch (VIX, breadth, composite, recession filter), not from bars alone; its event study is on the Regime page.',
    testOn: [],
  },
  {
    id: 'intraday-vwap-ema',
    number: 11,
    title: 'Intraday VWAP and EMA momentum (scalping)',
    horizon: 'scalp',
    rating: 'weak',
    sources: ['Barber, Lee, Liu and Odean, Journal of Financial Markets (2014)'],
    summary:
      'Your own setup, held to the strictest gates. Less than 1% of day traders earn predictable positive returns after fees; alerts are sized small and scored honestly.',
    rule: null,
    notTestableBecause: 'Needs intraday bars (a real-time plan).',
    testOn: [],
  },
];

/** What Marsad leaves out, and why (the brief's list). */
export const LEFT_OUT: readonly { title: string; why: string }[] = [
  { title: 'Copying congressional trades', why: 'Disclosures arrive 30 to 45 days late.' },
  {
    title: 'Selling options on volatile single stocks ("the wheel")',
    why: 'Small steady premiums with large tail losses.',
  },
  {
    title: 'Methods that cannot be falsified or tested',
    why: 'Pure Elliott-wave counts, Fibonacci-only targets and max-pain pinning make no testable prediction.',
  },
  {
    title: 'Price targets produced by a language model',
    why: 'AI explains; code decides and calculates.',
  },
  {
    title: 'Averaging down without a stop, and martingale sizing',
    why: 'Losses compound without limit.',
  },
];
