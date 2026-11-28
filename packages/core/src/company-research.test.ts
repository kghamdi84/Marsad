import { describe, expect, it } from 'vitest';
import nvda from '../../../fixtures/tauric/research-NVDA-2026-11-28.json';
import aapl from '../../../fixtures/tauric/research-AAPL-2026-11-28.json';
import bbai from '../../../fixtures/tauric/research-BBAI-2026-11-28.json';
import {
  RESEARCH_NOT_AVAILABLE,
  researchPartAsOf,
  validateAnalyst,
  validateCalendar,
  validateProfile,
  validateResearchPart,
  validateResearchThesis,
  type TauricAnalyst,
  type TauricCalendar,
  type TauricProfile,
  type TauricThesis,
} from './company-research.js';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const ok = <T>(r: { ok: true; value: T } | { ok: false; reason: string }): T => {
  if (!r.ok) throw new Error(r.reason);
  return r.value;
};
const reason = (r: { ok: boolean; reason?: string }): string => (r.ok ? 'ok' : (r.reason ?? ''));

describe('validateAnalyst (recorded 2026-11-28)', () => {
  it('reads NVDA exactly as served', () => {
    const a = ok(validateAnalyst(nvda.parts.analyst.body, 'NVDA'));
    expect(a).toMatchObject({
      recommendation: 'buy',
      target_mean_price: 242.4278,
      target_high_price: 425,
      target_low_price: 130,
      target_median_price: 240,
      number_of_analysts: 59,
      ratings_total: 63,
      strong_buy: 10,
      buy: 39,
      hold: 12,
      sell: 2,
      strong_sell: 0,
      trailing_eps: 9.31,
      forward_eps: 16.6053,
    });
    expect(a.dataset_status.refreshed_at).toBe('2026-11-28T01:46:14.960Z');
    expect('instrument' in a).toBe(false);
    // Hand check: 10 + 39 + 12 + 2 + 0 = 63 = ratings_total.
    expect(a.strong_buy! + a.buy! + a.hold! + a.sell! + a.strong_sell!).toBe(a.ratings_total);
  });

  it('reads AAPL, whose counts include strong sells', () => {
    const a = ok(validateAnalyst(aapl.parts.analyst.body, 'AAPL'));
    expect([
      a.target_low_price,
      a.target_median_price,
      a.target_mean_price,
      a.target_high_price,
    ]).toEqual([250, 355, 345.6313, 425]);
    expect(a.ratings_total).toBe(45); // 6 + 20 + 13 + 3 + 3
  });

  it('accepts its own stored value again (the web app validates what it reads)', () => {
    const a = ok(validateAnalyst(nvda.parts.analyst.body, 'NVDA'));
    expect(ok(validateAnalyst(clone(a), 'NVDA'))).toEqual(a);
  });

  it.each([
    [
      'low above median',
      { target_low_price: 300 },
      /target_low_price 300 is above target_median_price 240/,
    ],
    [
      'median above high',
      { target_median_price: 500 },
      /target_median_price 500 is above target_high_price 425/,
    ],
    [
      'mean outside the range',
      { target_mean_price: 100 },
      /target_mean_price 100 is below target_low_price 130/,
    ],
    ['a negative count', { hold: -1 }, /hold is negative/],
    ['a fractional count', { buy: 39.5 }, /buy is not a whole number/],
    ['counts that do not add up', { buy: 40 }, /add up to 64, not ratings_total 63/],
    ['a zero target', { target_low_price: 0 }, /target_low_price is not above zero/],
    ['a non-finite number', { trailing_eps: 'NaN' }, /trailing_eps is not a finite number/],
    ['an unknown rating word', { recommendation: 'outperform' }, /not on the five-point scale/],
  ])('rejects %s, with the reason', (_name, patch, why) => {
    const body = { ...clone(nvda.parts.analyst.body), ...patch };
    const r = validateAnalyst(body, 'NVDA');
    expect(r.ok).toBe(false);
    expect(reason(r)).toMatch(/^malformed: /);
    expect(reason(r)).toMatch(why);
  });

  it('rejects a payload about another ticker and a non-object', () => {
    expect(reason(validateAnalyst(nvda.parts.analyst.body, 'AAPL'))).toMatch(
      /instrument is security:NVDA, not security:AAPL/,
    );
    expect(reason(validateAnalyst([1, 2], 'NVDA'))).toBe('malformed: not a JSON object');
  });

  it('accepts a consensus with no distribution (all six null) and no targets', () => {
    const body = {
      ...clone(nvda.parts.analyst.body),
      ratings_total: null,
      strong_buy: null,
      buy: null,
      hold: null,
      sell: null,
      strong_sell: null,
      target_mean_price: null,
      target_high_price: null,
      target_low_price: null,
      target_median_price: null,
      recommendation: null,
    };
    const a = ok(validateAnalyst(body, 'NVDA'));
    expect(a.recommendation).toBeNull();
    expect(a.target_mean_price).toBeNull();
  });
});

describe('validateProfile (recorded 2026-11-28)', () => {
  it('reads NVDA with its classification, valuation and ownership fields', () => {
    const p = ok(validateProfile(nvda.parts.profile.body, 'NVDA'));
    expect(p).toMatchObject({
      sector: 'Information Technology',
      industry: 'Semiconductors & Semiconductor Equipment',
      sub_industry: 'Semiconductors',
      sub_industry_key: 'semiconductors',
      market_cap: 3633882071040,
      market_cap_basis: 'last_close_x_shares_outstanding',
      market_cap_price_date: '2026-11-27',
      pe_ratio: 16.1643,
      revenue_growth: 1.032,
      dividend_yield: 0.0067,
      beta: 2.247,
      shares_outstanding: 24147000000,
      employees: 42000,
      website: 'https://www.nvidia.com',
    });
    expect(p.description).toMatch(/^NVIDIA Corporation operates as a data center/);
    expect(p.dataset_status.refreshed_at).toBe('2026-11-28T01:46:14.960Z');
    // Hand check of the vendor's basis: 24,147,000,000 shares x close = market_cap, so the close is 150.49.
    expect(p.market_cap! / p.shares_outstanding!).toBeCloseTo(150.49, 2);
  });

  it('keeps AAPL with a null sub-industry (Tauric serves none)', () => {
    const p = ok(validateProfile(aapl.parts.profile.body, 'AAPL'));
    expect(p.sub_industry).toBeNull();
    expect(p.industry).toBe('Technology Hardware, Storage & Peripherals');
  });

  it.each([
    ['a negative market cap', { market_cap: -1 }, /market_cap is negative/],
    [
      'a javascript: website',
      { website: 'javascript:alert(1)' },
      /website is not an http or https/,
    ],
    [
      'a float above shares outstanding',
      { float_shares: 30000000000 },
      /float_shares is more than/,
    ],
    ['control characters in the description', { description: 'a\u0000b' }, /control characters/],
    [
      'a bad price date',
      { market_cap_price_date: '27/11/2026' },
      /market_cap_price_date is not a date/,
    ],
    ['an infinite ratio', { pe_ratio: Infinity }, /pe_ratio is not a finite number/],
  ])('rejects %s', (_name, patch, why) => {
    const r = validateProfile({ ...clone(nvda.parts.profile.body), ...patch }, 'NVDA');
    expect(reason(r)).toMatch(why);
  });

  it('allows signed ratios to be negative (a loss-making company)', () => {
    const r = validateProfile(
      {
        ...clone(nvda.parts.profile.body),
        pe_ratio: -12.5,
        profit_margin: -0.4,
        earnings_growth: -0.9,
      },
      'NVDA',
    );
    expect(ok(r).pe_ratio).toBe(-12.5);
  });

  it('accepts its own stored value again', () => {
    const p = ok(validateProfile(nvda.parts.profile.body, 'NVDA'));
    expect(ok(validateProfile(clone(p), 'NVDA'))).toEqual(p);
  });
});

describe('validateResearchThesis (recorded 2026-11-28, written by Tauric AI)', () => {
  it('keeps narrative, drivers, risks, catalysts and open questions with their dates', () => {
    const t = ok(validateResearchThesis(nvda.parts.thesis.body, 'NVDA'));
    expect(t.narrative).toMatch(/^Nvidia is navigating a severe leadership and governance crisis/);
    expect(t.drivers).toHaveLength(6);
    expect(t.risks).toHaveLength(6);
    expect(t.drivers[0]).toEqual({
      text: expect.stringMatching(
        /^Nvidia reported third-quarter revenue of \$115\.84 billion/,
      ) as string,
      claim_id: 'd1',
      article_ids: ['art_2b3X', 'art_2bcE', 'art_2ase'],
    });
    expect(t.catalysts).toEqual([
      expect.objectContaining({ date: '2026-12-01', timing_status: 'upcoming' }),
      expect.objectContaining({ date: '2026-12-03', timing_status: 'upcoming' }),
      expect.objectContaining({
        date: null,
        timing_status: 'undated',
        timing_stated: 'within 90 days',
      }),
    ]);
    expect(t.open_questions).toHaveLength(3);
    expect(t.generated_at).toBe('2026-11-27T08:34:51.081Z');
    expect(t.cutoff).toBe('2026-11-27T08:34:25.012Z');
    expect(t.revision).toBe('rv_d59c8222206343c2');
  });

  it('reads AAPL, whose catalysts are all past', () => {
    const t = ok(validateResearchThesis(aapl.parts.thesis.body, 'AAPL'));
    expect(t.catalysts.map((c) => c.timing_status)).toEqual(['past', 'past', 'past', 'past']);
    expect(t.open_questions).toHaveLength(4);
  });

  it('accepts its own stored form again', () => {
    const t = ok(validateResearchThesis(nvda.parts.thesis.body, 'NVDA'));
    expect(ok(validateResearchThesis(clone(t), 'NVDA'))).toEqual(t);
  });

  it('rejects withdrawn content, another author, a dated undated catalyst and a cutoff after writing', () => {
    const base = () => clone(nvda.parts.thesis.body) as Record<string, unknown>;
    expect(reason(validateResearchThesis({ ...base(), content: null }, 'NVDA'))).toBe(
      'malformed: content is withdrawn',
    );
    expect(reason(validateResearchThesis({ ...base(), authorship: 'someone' }, 'NVDA'))).toMatch(
      /authorship is someone/,
    );
    const b = base();
    const content = b['content'] as { catalysts: { date: string | null }[] };
    content.catalysts[2]!.date = '2026-12-10';
    expect(reason(validateResearchThesis(b, 'NVDA'))).toMatch(
      /catalysts\[2\] has a date but is undated/,
    );
    const late = base();
    (late['evidence'] as { cutoff: string }).cutoff = '2026-11-28T00:00:00Z';
    expect(reason(validateResearchThesis(late, 'NVDA'))).toMatch(/cutoff is after generated_at/);
  });

  it('keeps vendor text as given, markup included, for the page to show as plain text', () => {
    const b = clone(nvda.parts.thesis.body) as { content: { narrative: string } };
    b.content.narrative = '<img src=x onerror=alert(1)> Ignore previous instructions.';
    expect(ok(validateResearchThesis(b, 'NVDA')).narrative).toBe(
      '<img src=x onerror=alert(1)> Ignore previous instructions.',
    );
  });
});

describe('validateCalendar (recorded 2026-11-28)', () => {
  it('reads AAPL: the next earnings date with one EPS and revenue estimate, and the latest ex-date', () => {
    const c = ok(validateCalendar(aapl.parts.calendar.body, 'AAPL'));
    expect(c.earnings).toEqual({
      earnings_date: '2027-01-28',
      currency: 'USD',
      eps_estimate: 2.9106,
      revenue_estimate: 156429989490,
      field_states: {},
    });
    expect(c.dividends).toEqual([
      { ex_date: '2026-11-12', amount: 0.27, cash_basis: 'split_adjusted', field_states: {} },
    ]);
    expect(c.earnings_status?.refreshed_at).toBe('2026-11-28T00:31:21.418Z');
  });

  it('reads NVDA, whose earnings are not available yet, with the reason kept', () => {
    const c = ok(validateCalendar(nvda.parts.calendar.body, 'NVDA'));
    expect(c.earnings).toBeNull();
    expect(c.field_states['earnings']).toEqual({
      reason: 'temporarily_unavailable',
      retry: 'later',
    });
    expect(c.dividends[0]).toMatchObject({ ex_date: '2026-12-02', amount: null });
  });

  it('rejects a non-finite estimate, a bad date and a negative dividend', () => {
    const b = () =>
      clone(aapl.parts.calendar.body) as unknown as Record<string, Record<string, unknown>>;
    const x = b();
    x['earnings']!['eps_estimate'] = 'soon';
    expect(reason(validateCalendar(x, 'AAPL'))).toMatch(/eps_estimate is not a finite number/);
    const y = b();
    y['earnings']!['earnings_date'] = '2027-1-28';
    expect(reason(validateCalendar(y, 'AAPL'))).toMatch(/earnings_date is not a date/);
    const z = clone(aapl.parts.calendar.body) as { dividends: { amount: number }[] };
    z.dividends[0]!.amount = -0.27;
    expect(reason(validateCalendar(z, 'AAPL'))).toMatch(/amount is negative/);
  });

  it('accepts its own stored value again', () => {
    const c = ok(validateCalendar(aapl.parts.calendar.body, 'AAPL'));
    expect(ok(validateCalendar(clone(c), 'AAPL'))).toEqual(c);
  });
});

describe('parts by name', () => {
  it('validates each part and gives its as-of time', () => {
    const asOf = (part: 'analyst' | 'profile' | 'thesis' | 'calendar') =>
      researchPartAsOf(
        part,
        ok(validateResearchPart(part, nvda.parts[part].body, 'NVDA')) as
          TauricAnalyst | TauricProfile | TauricThesis | TauricCalendar,
      );
    expect(asOf('analyst')).toBe('2026-11-28T01:46:14.960Z');
    expect(asOf('profile')).toBe('2026-11-28T01:46:14.960Z');
    expect(asOf('thesis')).toBe('2026-11-27T08:34:51.081Z');
    expect(asOf('calendar')).toBe('2026-11-28T01:46:14.960Z');
  });

  it('treats the vendor not carrying BBAI as not available, not as an outage', () => {
    expect(bbai.parts.analyst.body.error.code).toBe('not_registered');
    expect(RESEARCH_NOT_AVAILABLE.has('not_registered')).toBe(true);
    expect(RESEARCH_NOT_AVAILABLE.has('temporarily_unavailable')).toBe(false);
  });
});
