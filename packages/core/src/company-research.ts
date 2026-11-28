/**
 * Company research from Tauric (ADR 0047): analyst consensus, company profile and the Tauric AI thesis, each
 * validated on its own so one bad part never hides the others. Version `tauric-research-1`.
 *
 * The routes (public https://api.tauric.ai/openapi.json, read 2026-11-28): `GET /v1/securities/{symbol}/analyst`
 * (schema `AnalystConsensus`), `GET /v1/securities/{symbol}/profile` (`SecurityProfile`) and
 * `GET /v1/securities/{symbol}/thesis` (`ThesisResponse`, authored by Tauric AI) and
 * `GET /v1/securities/{symbol}/calendar` (`SecurityCalendar`: the next earnings date with one consensus EPS and
 * revenue estimate, and the latest stated dividend ex-date; the vendor states reported actuals and surprises are
 * unavailable). Recorded answers are fixtures/tauric/research-{NVDA,AAPL,BBAI}-2026-11-28.json.
 *
 * Each validator takes the vendor payload (with or without `instrument`) and returns the value Marsad stores in
 * `public.company_research`, or a reason. The web app runs the same validators on the stored JSON, so a value
 * that would not pass today is never shown. Nothing is guessed or repaired: a malformed part is rejected whole.
 * Vendor text (description, thesis) is data to show as plain text, never markup or instructions.
 */

export const RESEARCH_VERSION = 'tauric-research-1';

export type ResearchPart = 'analyst' | 'profile' | 'thesis' | 'calendar';
/** Fetch order: the profile first, so a ticker Tauric does not carry costs one error answer (no credit). */
export const RESEARCH_PARTS: readonly ResearchPart[] = ['profile', 'analyst', 'thesis', 'calendar'];

export type ResearchResult<T> = { ok: true; value: T } | { ok: false; reason: string };

export type AnalystRecommendation = 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell';
const RECOMMENDATIONS: readonly AnalystRecommendation[] = [
  'strong_buy',
  'buy',
  'hold',
  'sell',
  'strong_sell',
];

/** The vendor's `dataset_status`, as stored. */
export interface ResearchDatasetStatus {
  dataset: string;
  complete: boolean | null;
  complete_reason: string | null;
  refreshed_at: string | null;
}

/** Fields the vendor marks with a limit, each `{reason, retry}` (for example a null value it explains). */
export type ResearchFieldStates = Record<string, { reason: string; retry: string }>;

/** `AnalystConsensus` minus `instrument`. Prices are in the listing's currency (USD here). */
export interface TauricAnalyst {
  dataset_status: ResearchDatasetStatus;
  field_states: ResearchFieldStates;
  price_basis: string | null;
  recommendation: AnalystRecommendation | null;
  target_mean_price: number | null;
  target_high_price: number | null;
  target_low_price: number | null;
  target_median_price: number | null;
  number_of_analysts: number | null;
  ratings_total: number | null;
  strong_buy: number | null;
  buy: number | null;
  hold: number | null;
  sell: number | null;
  strong_sell: number | null;
  trailing_eps: number | null;
  forward_eps: number | null;
}

/** `SecurityProfile` minus `instrument`. Fractions are fractions (0.0067 is 0.67%), as the vendor documents. */
export interface TauricProfile {
  dataset_status: ResearchDatasetStatus;
  field_states: ResearchFieldStates;
  price_basis: string | null;
  sector: string | null;
  sector_key: string | null;
  industry_group: string | null;
  industry_group_key: string | null;
  industry: string | null;
  industry_key: string | null;
  sub_industry: string | null;
  sub_industry_key: string | null;
  country: string | null;
  financial_currency: string | null;
  market_cap: number | null;
  market_cap_basis: string | null;
  market_cap_price_date: string | null;
  enterprise_value: number | null;
  pe_ratio: number | null;
  forward_pe: number | null;
  peg_ratio: number | null;
  price_to_book: number | null;
  price_to_sales: number | null;
  profit_margin: number | null;
  operating_margin: number | null;
  return_on_assets: number | null;
  return_on_equity: number | null;
  revenue_growth: number | null;
  earnings_growth: number | null;
  total_cash: number | null;
  total_debt: number | null;
  debt_to_equity: number | null;
  current_ratio: number | null;
  quick_ratio: number | null;
  dividend_rate: number | null;
  dividend_yield: number | null;
  payout_ratio: number | null;
  beta: number | null;
  shares_outstanding: number | null;
  float_shares: number | null;
  employees: number | null;
  website: string | null;
  description: string | null;
  shares_short: number | null;
  days_to_cover: number | null;
  short_interest_of_float: number | null;
  institutional_ownership: number | null;
  insider_ownership: number | null;
}

export interface ThesisClaim {
  text: string;
  claim_id: string;
  article_ids: string[];
}

export type CatalystTiming = 'past' | 'same_day' | 'upcoming' | 'undated';
const TIMINGS: readonly CatalystTiming[] = ['past', 'same_day', 'upcoming', 'undated'];

export interface ThesisCatalyst {
  /** YYYY-MM-DD, or null when the vendor gives no date (`timing_status` is then `undated`). */
  date: string | null;
  text: string;
  /** The vendor's words for the timing ("within 90 days"), or null. */
  timing_stated: string | null;
  timing_status: CatalystTiming;
}

/** The stored thesis: written by Tauric AI, never Marsad's view and never advice. */
export interface TauricThesis {
  narrative: string;
  drivers: ThesisClaim[];
  risks: ThesisClaim[];
  catalysts: ThesisCatalyst[];
  open_questions: string[];
  generated_at: string;
  /** The evidence cutoff, or null when the vendor states none. */
  cutoff: string | null;
  revision: string | null;
}

// Limits that keep a runaway payload out of the database; far above anything recorded.
const MAX_TEXT = 6000;
const MAX_ITEMS = 40;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KEY = /^[a-z0-9_]{1,80}$/;

class Malformed extends Error {}
const bad = (why: string): never => {
  throw new Malformed(why);
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function finite(o: Obj, k: string): number | null {
  const v = o[k];
  if (v === null || v === undefined) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) return bad(`${k} is not a finite number`);
  return v;
}

function nonNegative(o: Obj, k: string): number | null {
  const v = finite(o, k);
  if (v !== null && v < 0) bad(`${k} is negative (${v})`);
  return v;
}

function positive(o: Obj, k: string): number | null {
  const v = finite(o, k);
  if (v !== null && v <= 0) bad(`${k} is not above zero (${v})`);
  return v;
}

function count(o: Obj, k: string): number | null {
  const v = nonNegative(o, k);
  if (v !== null && !Number.isInteger(v)) bad(`${k} is not a whole number (${v})`);
  return v;
}

function text(o: Obj, k: string, max = MAX_TEXT): string | null {
  const v = o[k];
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return bad(`${k} is not text`);
  if (v.length > max) bad(`${k} is longer than ${max} characters`);
  // A NUL or other control character (tabs and newlines aside) is never in real vendor text.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(v))
    bad(`${k} holds control characters`);
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function key(o: Obj, k: string): string | null {
  const v = text(o, k, 80);
  if (v !== null && !KEY.test(v)) bad(`${k} is not a key (${v.slice(0, 40)})`);
  return v;
}

function instant(v: unknown, k: string): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v)) || !/[zZ]|[+-]\d{2}:?\d{2}$/.test(v))
    return bad(`${k} is not a time with a zone`);
  return new Date(Date.parse(v)).toISOString();
}

function dateOnly(o: Obj, k: string): string | null {
  const v = o[k];
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string' || !DATE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`)))
    return bad(`${k} is not a date (YYYY-MM-DD)`);
  return v;
}

function fieldStates(v: unknown): ResearchFieldStates {
  if (v === null || v === undefined) return {};
  if (!isObj(v)) return bad('field_states is not an object');
  const out: ResearchFieldStates = {};
  for (const [k, s] of Object.entries(v)) {
    if (!isObj(s) || typeof s['reason'] !== 'string' || typeof s['retry'] !== 'string')
      bad(`field_states.${k} has no reason and retry`);
    const st = s as { reason: string; retry: string };
    out[k] = { reason: st.reason, retry: st.retry };
  }
  return out;
}

function datasetStatus(v: unknown, expected: string): ResearchDatasetStatus {
  if (!isObj(v)) return bad('dataset_status is missing');
  if (v['dataset'] !== expected)
    bad(`dataset_status.dataset is ${String(v['dataset'])}, not ${expected}`);
  const complete = v['complete'];
  if (complete !== null && complete !== undefined && typeof complete !== 'boolean')
    bad('dataset_status.complete is not true, false or null');
  return {
    dataset: expected,
    complete: typeof complete === 'boolean' ? complete : null,
    complete_reason: key(v, 'complete_reason'),
    refreshed_at: instant(v['refreshed_at'], 'dataset_status.refreshed_at'),
  };
}

/** When the payload carries `instrument`, it must name the ticker asked for. */
function checkInstrument(o: Obj, ticker: string): void {
  const inst = o['instrument'];
  if (inst === undefined) return;
  if (!isObj(inst) || inst['key'] !== `security:${ticker}`)
    bad(`instrument is ${isObj(inst) ? String(inst['key']) : 'missing'}, not security:${ticker}`);
}

function run<T>(json: unknown, fn: (o: Obj) => T): ResearchResult<T> {
  try {
    if (!isObj(json)) return { ok: false, reason: 'malformed: not a JSON object' };
    return { ok: true, value: fn(json) };
  } catch (e) {
    if (e instanceof Malformed) return { ok: false, reason: `malformed: ${e.message}` };
    throw e;
  }
}

/**
 * Validates an analyst consensus. Targets must be above zero and ordered low <= median <= high with the mean
 * inside low to high; rating counts must be whole and non-negative and add up to `ratings_total`.
 */
export function validateAnalyst(json: unknown, ticker: string): ResearchResult<TauricAnalyst> {
  return run(json, (o) => {
    checkInstrument(o, ticker);
    const rec = o['recommendation'];
    if (
      rec !== null &&
      rec !== undefined &&
      !RECOMMENDATIONS.includes(rec as AnalystRecommendation)
    )
      bad(`recommendation ${String(rec).slice(0, 40)} is not on the five-point scale`);
    const a: TauricAnalyst = {
      dataset_status: datasetStatus(o['dataset_status'], 'analyst'),
      field_states: fieldStates(o['field_states']),
      price_basis: key(o, 'price_basis'),
      recommendation: (rec ?? null) as AnalystRecommendation | null,
      target_mean_price: positive(o, 'target_mean_price'),
      target_high_price: positive(o, 'target_high_price'),
      target_low_price: positive(o, 'target_low_price'),
      target_median_price: positive(o, 'target_median_price'),
      number_of_analysts: count(o, 'number_of_analysts'),
      ratings_total: count(o, 'ratings_total'),
      strong_buy: count(o, 'strong_buy'),
      buy: count(o, 'buy'),
      hold: count(o, 'hold'),
      sell: count(o, 'sell'),
      strong_sell: count(o, 'strong_sell'),
      trailing_eps: finite(o, 'trailing_eps'),
      forward_eps: finite(o, 'forward_eps'),
    };
    const { target_low_price: lo, target_median_price: med, target_high_price: hi } = a;
    const mean = a.target_mean_price;
    if (lo !== null && med !== null && lo > med)
      bad(`target_low_price ${lo} is above target_median_price ${med}`);
    if (med !== null && hi !== null && med > hi)
      bad(`target_median_price ${med} is above target_high_price ${hi}`);
    if (lo !== null && hi !== null && lo > hi)
      bad(`target_low_price ${lo} is above target_high_price ${hi}`);
    if (mean !== null && lo !== null && mean < lo)
      bad(`target_mean_price ${mean} is below target_low_price ${lo}`);
    if (mean !== null && hi !== null && mean > hi)
      bad(`target_mean_price ${mean} is above target_high_price ${hi}`);
    const counts = [a.strong_buy, a.buy, a.hold, a.sell, a.strong_sell];
    if (a.ratings_total !== null) {
      if (counts.some((c) => c === null)) bad('ratings_total is given without all five counts');
      const sum = counts.reduce<number>((s, c) => s + (c ?? 0), 0);
      if (sum !== a.ratings_total)
        bad(`the five rating counts add up to ${sum}, not ratings_total ${a.ratings_total}`);
    }
    return a;
  });
}

const PROFILE_TEXT = [
  'sector',
  'industry_group',
  'industry',
  'sub_industry',
  'country',
  'financial_currency',
] as const;
const PROFILE_KEYS = [
  'sector_key',
  'industry_group_key',
  'industry_key',
  'sub_industry_key',
  'market_cap_basis',
  'price_basis',
] as const;
/** Amounts, counts and fractions that cannot be negative. */
const PROFILE_NON_NEGATIVE = [
  'market_cap',
  'total_cash',
  'total_debt',
  'debt_to_equity',
  'current_ratio',
  'quick_ratio',
  'dividend_rate',
  'dividend_yield',
  'shares_outstanding',
  'float_shares',
  'employees',
  'shares_short',
  'days_to_cover',
  'short_interest_of_float',
  'institutional_ownership',
  'insider_ownership',
  'price_to_book',
  'price_to_sales',
] as const;
/** Ratios that can be negative (losses, falling revenue, a negative enterprise value). */
const PROFILE_SIGNED = [
  'enterprise_value',
  'pe_ratio',
  'forward_pe',
  'peg_ratio',
  'profit_margin',
  'operating_margin',
  'return_on_assets',
  'return_on_equity',
  'revenue_growth',
  'earnings_growth',
  'payout_ratio',
  'beta',
] as const;

/**
 * Validates a company profile: numbers finite, amounts and counts non-negative, keys in the vendor's key form,
 * the website an http(s) address, the description plain text within the size limit.
 */
export function validateProfile(json: unknown, ticker: string): ResearchResult<TauricProfile> {
  return run(json, (o) => {
    checkInstrument(o, ticker);
    const website = text(o, 'website', 300);
    if (website !== null && !/^https?:\/\/[^\s<>"']+$/i.test(website))
      bad('website is not an http or https address');
    const out: Obj = {
      dataset_status: datasetStatus(o['dataset_status'], 'profile'),
      field_states: fieldStates(o['field_states']),
      market_cap_price_date: dateOnly(o, 'market_cap_price_date'),
      website,
      description: text(o, 'description'),
    };
    for (const k of PROFILE_TEXT) out[k] = text(o, k, 200);
    for (const k of PROFILE_KEYS) out[k] = key(o, k);
    for (const k of PROFILE_NON_NEGATIVE) out[k] = nonNegative(o, k);
    for (const k of PROFILE_SIGNED) out[k] = finite(o, k);
    for (const k of ['shares_outstanding', 'float_shares', 'employees', 'shares_short'] as const)
      count(o, k);
    if (
      out['float_shares'] !== null &&
      out['shares_outstanding'] !== null &&
      (out['float_shares'] as number) > (out['shares_outstanding'] as number) * 1.05
    )
      bad('float_shares is more than shares_outstanding');
    return out as unknown as TauricProfile;
  });
}

function claims(v: unknown, name: string): ThesisClaim[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) return bad(`${name} is not a list`);
  if (v.length > MAX_ITEMS) bad(`${name} has more than ${MAX_ITEMS} items`);
  return v.map((c, i) => {
    if (!isObj(c)) return bad(`${name}[${i}] is not an object`);
    const t = text(c, 'text');
    if (t === null) return bad(`${name}[${i}] has no text`);
    const ids = c['article_ids'] ?? [];
    if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string' || x.length > 80))
      bad(`${name}[${i}].article_ids is not a list of ids`);
    return {
      text: t,
      claim_id: text(c, 'claim_id', 40) ?? `${name}-${i}`,
      article_ids: ids as string[],
    };
  });
}

/**
 * Validates a Tauric AI thesis and keeps what Marsad shows: narrative, drivers, risks, catalysts and open
 * questions, with when it was written, the evidence cutoff and the revision. `authorship` must be `tauric_ai`;
 * withdrawn content (null) is a reason, not an empty thesis.
 */
export function validateResearchThesis(
  json: unknown,
  ticker: string,
): ResearchResult<TauricThesis> {
  return run(json, (o) => {
    checkInstrument(o, ticker);
    if (o['authorship'] !== undefined && o['authorship'] !== 'tauric_ai')
      bad(`authorship is ${String(o['authorship']).slice(0, 40)}, not tauric_ai`);
    // The stored form has the content fields at the top; the vendor's has them under `content`.
    const stored = o['content'] === undefined && typeof o['narrative'] === 'string';
    const c = stored ? o : o['content'];
    if (c === null) return bad('content is withdrawn');
    if (!isObj(c)) return bad('content is missing');
    const narrative = text(c, 'narrative');
    if (narrative === null) return bad('narrative is empty');
    const rawCats = c['catalysts'] ?? [];
    if (!Array.isArray(rawCats) || rawCats.length > MAX_ITEMS) bad('catalysts is not a short list');
    const catalysts = (rawCats as unknown[]).map((k, i): ThesisCatalyst => {
      if (!isObj(k)) return bad(`catalysts[${i}] is not an object`);
      const t = text(k, 'text');
      if (t === null) return bad(`catalysts[${i}] has no text`);
      const timing = k['timing_status'];
      if (!TIMINGS.includes(timing as CatalystTiming))
        bad(`catalysts[${i}].timing_status ${String(timing).slice(0, 20)} is not known`);
      const date = dateOnly(k, 'date');
      if ((date === null) !== (timing === 'undated'))
        bad(`catalysts[${i}] has ${date === null ? 'no date' : 'a date'} but is ${String(timing)}`);
      return {
        date,
        text: t,
        timing_stated: text(k, 'timing_stated', 200),
        timing_status: timing as CatalystTiming,
      };
    });
    const rawQs = c['open_questions'] ?? [];
    if (!Array.isArray(rawQs) || rawQs.length > MAX_ITEMS)
      bad('open_questions is not a short list');
    const open_questions = (rawQs as unknown[]).map((q, i) => {
      const t = text({ q }, 'q');
      if (t === null) return bad(`open_questions[${i}] is empty`);
      return t;
    });
    const generated = instant(o['generated_at'], 'generated_at');
    if (generated === null) return bad('generated_at is missing');
    const evidence = o['evidence'];
    const cutoff = stored
      ? instant(o['cutoff'], 'cutoff')
      : isObj(evidence)
        ? instant(evidence['cutoff'], 'evidence.cutoff')
        : null;
    if (cutoff !== null && Date.parse(cutoff) > Date.parse(generated))
      bad('the evidence cutoff is after generated_at');
    const revision = text(o, 'revision', 40);
    if (revision !== null && !/^rv_[0-9a-f]{16}$/.test(revision))
      bad('revision is not a revision id');
    return {
      narrative,
      drivers: claims(c['drivers'], 'drivers'),
      risks: claims(c['risks'], 'risks'),
      catalysts,
      open_questions,
      generated_at: generated,
      cutoff,
      revision,
    };
  });
}

/** The next (or latest stated) earnings event. Amounts are in `currency`, as the vendor gives them. */
export interface CalendarEarnings {
  /** YYYY-MM-DD of the next earnings release, or null. */
  earnings_date: string | null;
  currency: string | null;
  /** Consensus EPS for that quarter, or null. */
  eps_estimate: number | null;
  /** Consensus revenue for that quarter in whole units of `currency`, or null. */
  revenue_estimate: number | null;
  field_states: ResearchFieldStates;
}

export interface CalendarDividend {
  /** The latest stated ex-date, past or upcoming: compare with today before calling it upcoming. */
  ex_date: string | null;
  /** Cash per share on `cash_basis`; null until the vendor has the amount. */
  amount: number | null;
  cash_basis: string | null;
  field_states: ResearchFieldStates;
}

/** `SecurityCalendar` minus `instrument`. No reported EPS and no surprise: the vendor does not serve them. */
export interface TauricCalendar {
  /** Null when no event is published or not available yet (the reason is in `field_states.earnings`). */
  earnings: CalendarEarnings | null;
  earnings_status: ResearchDatasetStatus | null;
  dividends: CalendarDividend[];
  dividends_status: ResearchDatasetStatus | null;
  field_states: ResearchFieldStates;
}

/** Validates an earnings and dividend calendar: estimates finite, dates YYYY-MM-DD, amounts non-negative. */
export function validateCalendar(json: unknown, ticker: string): ResearchResult<TauricCalendar> {
  return run(json, (o) => {
    checkInstrument(o, ticker);
    const e = o['earnings'];
    let earnings: CalendarEarnings | null = null;
    if (e !== null && e !== undefined) {
      if (!isObj(e)) return bad('earnings is not an object');
      earnings = {
        earnings_date: dateOnly(e, 'earnings_date'),
        currency: text(e, 'currency', 8),
        eps_estimate: finite(e, 'eps_estimate'),
        revenue_estimate: nonNegative(e, 'revenue_estimate'),
        field_states: fieldStates(e['field_states']),
      };
      if (earnings.currency !== null && !/^[A-Z]{3}$/.test(earnings.currency))
        bad('earnings.currency is not an ISO 4217 code');
    }
    const ds = o['dividends'] ?? [];
    if (!Array.isArray(ds) || ds.length > MAX_ITEMS) return bad('dividends is not a short list');
    const dividends = (ds as unknown[]).map((d, i): CalendarDividend => {
      if (!isObj(d)) return bad(`dividends[${i}] is not an object`);
      return {
        ex_date: dateOnly(d, 'ex_date'),
        amount: nonNegative(d, 'amount'),
        cash_basis: key(d, 'cash_basis'),
        field_states: fieldStates(d['field_states']),
      };
    });
    const status = (v: unknown, name: string) =>
      v === null || v === undefined ? null : datasetStatus(v, name);
    return {
      earnings,
      earnings_status: status(o['earnings_status'], 'earnings'),
      dividends,
      dividends_status: status(o['dividends_status'], 'dividends'),
      field_states: fieldStates(o['field_states']),
    };
  });
}

export type ResearchValue = TauricAnalyst | TauricProfile | TauricThesis | TauricCalendar;

/** Validates one part by name. */
export function validateResearchPart(
  part: ResearchPart,
  json: unknown,
  ticker: string,
): ResearchResult<ResearchValue> {
  if (part === 'analyst') return validateAnalyst(json, ticker);
  if (part === 'profile') return validateProfile(json, ticker);
  if (part === 'calendar') return validateCalendar(json, ticker);
  return validateResearchThesis(json, ticker);
}

/**
 * The as-of time of a validated part: the vendor's refresh time, when the thesis was written, or for the
 * calendar the earlier of its two dataset refresh times.
 */
export function researchPartAsOf(part: ResearchPart, value: ResearchValue): string | null {
  if (part === 'thesis') return (value as TauricThesis).generated_at;
  if (part === 'calendar') {
    const c = value as TauricCalendar;
    const times = [c.earnings_status?.refreshed_at, c.dividends_status?.refreshed_at]
      .filter((t): t is string => typeof t === 'string')
      .sort();
    return times[0] ?? null;
  }
  return (value as TauricAnalyst | TauricProfile).dataset_status.refreshed_at;
}

/**
 * Vendor answers that mean Tauric has nothing for this ticker and part (the ticker is not carried, the part is
 * not offered or not published for it). They are settled facts to show, not outages, and cost no credit.
 */
export const RESEARCH_NOT_AVAILABLE: ReadonlySet<string> = new Set([
  'not_registered',
  'not_supported',
  'not_published',
  'delisted',
  'insufficient_history',
  'not_found',
]);
