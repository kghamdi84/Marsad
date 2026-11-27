/**
 * The company brief (formula `company-brief-1`): one summary of a company from data Marsad already stores, computed
 * by code (no AI). It reuses the snapshot (`snapshot-1`), investor (`investor-1`), trader (`trader-1`) and strength
 * (`strength-1`) figures rather than computing them again, and adds rule-based checks, stored sentiment counts, market
 * context and what comes next. Every figure keeps its date; an input that is missing gives null, never a guess.
 *
 * An input of null means "not loaded or not stored" (the page shows "Not available"); an empty list means "loaded,
 * and there were none". Marsad does not forecast: the context section states conditions with their dates only.
 */
import type { FinancialFact } from './adapters/sec-facts.js';
import { etDate } from './calendar.js';
import type { EarningsEstimate } from './econ-calendar.js';
import { pointInTime, preferConcepts, quarterlyValues } from './fundamentals.js';
import { sma } from './indicators.js';
import { investorView, INVESTOR_VERSION } from './investor.js';
import { cleanSectionLines, splitRiskSentences } from './riskfactors.js';
import { relativeStrength } from './rotation.js';
import { companySnapshot, SNAPSHOT_VERSION } from './snapshot.js';
import { STRENGTH_VERSION } from './strength.js';
import type { AlertEvent, DailyBar, DividendEvent, HaltEvent } from './study.js';
import { daysBetween, traderMetrics, TRADER_VERSION } from './trader.js';

export const COMPANY_BRIEF_VERSION = 'company-brief-1';

/** Every threshold the checks use, in one place so the page can state them. Percentages are in percent. */
export const BRIEF_RULES = Object.freeze({
  /** Revenue over four quarters against the four a year earlier: a strength at or above this. */
  revenueGrowthPct: 10,
  /** Net margin over four quarters: a strength at or above this; a loss (below 0) is a risk. */
  netMarginPct: 15,
  /** Diluted share count against a year earlier: a risk at or above this (dilution)... */
  dilutionPct: 2,
  /** ...and a strength at or below this (the count is shrinking). */
  shrinkPct: -1,
  /** Short interest as a share of shares outstanding: a risk at or above this. */
  shortInterestPct: 10,
  /** Return against SPY over 63 sessions (trader-1), in percent: a strength at or above, a risk at or below minus. */
  rsSpyPct: 5,
  /** Strength percentile in the universe (strength-1): a strength at or above, a risk at or below. */
  strengthTop: 80,
  strengthBottom: 20,
  /** Close against the 52-week closing high (trader-1): a risk at or below this. */
  fromHighPct: -20,
  /** An estimated earnings date this many calendar days away or fewer is event risk. */
  earningsDays: 14,
  /** Windows in calendar days. */
  insiderDays: 90,
  newsDays: 30,
  eventDays: 30,
  /** No percentage from fewer than this many labelled stories (integrity rule 10). */
  minStories: 30,
});

/** Trading sessions in each return window. */
export const BRIEF_PERIODS = Object.freeze({ m1: 21, m3: 63, y1: 252 });

export interface BriefFiling {
  accession: string;
  form: string;
  filingDate: string;
  items: readonly string[];
  primaryDocument: string | null;
}

export interface BriefNews {
  id: string;
  publishedAt: string;
  /** The vendor's stored labels per ticker; null or empty when none were stored for the story. */
  sentiment: readonly { ticker: string; label: string }[] | null;
}

export interface BriefInsiderTrade {
  date: string;
  code: string;
  acquiredDisposed: 'A' | 'D' | null;
  valueUsd: number | null;
  isAmendment: boolean;
  table: 'non-derivative' | 'derivative';
}

export interface BriefRegime {
  date: string;
  label: string;
  ruleVersion: string;
  recessionVersion: string;
  recessionLevel: string;
  triggered: number;
  available: number;
}

export interface CompanyBriefInput {
  ticker: string;
  /** Today's ET date: facts filed after it are not used, windows end on it. */
  asOf: string;
  name: string | null;
  business: { text: string; filingDate: string; periodEnd: string; filingUrl: string } | null;
  /** Ascending daily bars of the company. */
  bars: readonly DailyBar[];
  spy: readonly DailyBar[] | null;
  sector: { ticker: string; bars: readonly DailyBar[] } | null;
  facts: readonly FinancialFact[] | null;
  strength: { date: string; percentile: number; rank: number; members: number } | null;
  filings: readonly BriefFiling[] | null;
  news: readonly BriefNews[] | null;
  /** True when the news read hit its row limit, so the counts may not cover the whole window. */
  newsCapped?: boolean;
  insiders: readonly BriefInsiderTrade[] | null;
  shortInterest:
    readonly { date: string; shortInterest: number; daysToCover: number | null }[] | null;
  dividends: readonly DividendEvent[] | null;
  earnings: EarningsEstimate | null;
  regime: BriefRegime | null;
  riskFactors: { filingDate: string; noMaterialChanges: boolean; filingUrl: string } | null;
  halts: readonly HaltEvent[] | null;
  alerts: readonly AlertEvent[] | null;
}

export interface PeriodReturn {
  sessions: number;
  from: string;
  to: string;
  /** Fractions: 0.12 is +12%. */
  stock: number;
  spy: number | null;
  sector: number | null;
}

export type CheckId =
  | 'revenue-growth'
  | 'revenue-decline'
  | 'net-margin'
  | 'net-loss'
  | 'net-cash'
  | 'net-debt'
  | 'fcf-positive'
  | 'fcf-negative'
  | 'shares-shrinking'
  | 'dilution'
  | 'above-200'
  | 'below-200'
  | 'beats-spy'
  | 'lags-spy'
  | 'strength-top'
  | 'strength-bottom'
  | 'far-from-high'
  | 'short-interest'
  | 'insider-buying'
  | 'insider-selling'
  | 'earnings-soon'
  | 'recent-halt';

export interface BriefCheck {
  id: CheckId;
  side: 'strength' | 'risk';
  /** The measured value in the rule's unit (percent, dollars, days or a count). */
  value: number;
  /** The rule's threshold in the same unit; null when the rule is a sign (above or below zero, an average). */
  threshold: number | null;
  /** The date the value is as of. */
  date: string;
  /** A second figure some checks state (the 200-day average, the members ranked, sells in dollars). */
  extra?: number;
}

export interface CompanyBrief {
  ticker: string;
  asOf: string;
  formulaVersion: string;
  versions: { snapshot: string; investor: string; trader: string; strength: string };
  company: {
    name: string | null;
    whatItDoes: {
      sentence: string;
      filingDate: string;
      periodEnd: string;
      filingUrl: string;
    } | null;
    marketValue: {
      value: number;
      close: number;
      priceDate: string;
      shares: number;
      sharesDate: string;
    } | null;
  };
  performance: {
    close: { value: number; date: string } | null;
    returns: { m1: PeriodReturn | null; m3: PeriodReturn | null; y1: PeriodReturn | null };
    sectorTicker: string | null;
    revenue: { value: number; end: string; yoyPct: number | null } | null;
    netMargin: { pct: number; end: string } | null;
    freeCashFlow: { value: number; filed: string } | null;
    dilution: { pct: number; end: string } | null;
    strength: { percentile: number; rank: number; members: number; date: string } | null;
  };
  checks: BriefCheck[];
  sentiment: {
    news: {
      days: number;
      stories: number;
      positive: number;
      neutral: number;
      negative: number;
      /** Stories with no label for this ticker. */
      unlabelled: number;
      /** False when no story in the window carries a stored label at all. */
      stored: boolean;
      capped: boolean;
      /** Shares of the labelled stories, in percent; null below BRIEF_RULES.minStories labelled stories. */
      pct: { positive: number; neutral: number; negative: number } | null;
    } | null;
    insiders: {
      days: number;
      buys: number;
      sells: number;
      buyUsd: number;
      sellUsd: number;
      /** Buys minus sells in dollars, from trades with a value. */
      netUsd: number;
      /** Trades in the window with no dollar value reported. */
      unpriced: number;
    } | null;
    short: {
      date: string;
      shares: number;
      daysToCover: number | null;
      /** Of shares outstanding on the newest cover page, in percent. */
      pctOfShares: number | null;
      prior: { date: string; shares: number; changePct: number } | null;
    } | null;
  };
  context: {
    regime: { label: string; date: string; ruleVersion: string } | null;
    sector: { ticker: string; rs1m: number | null; rs3m: number | null; date: string } | null;
    recession: {
      level: string;
      triggered: number;
      available: number;
      date: string;
      version: string;
    } | null;
  };
  next: {
    latestReport: BriefFiling | null;
    riskFactors: { filingDate: string; changed: boolean; filingUrl: string } | null;
    earnings: (EarningsEstimate & { daysAway: number }) | null;
    exDividend: { date: string; cashAmount: number; currency: string } | null;
    halts: { count: number; newest: HaltEvent | null; days: number } | null;
    alerts: { count: number; newest: AlertEvent | null; days: number } | null;
  };
}

const REPORT_FORMS = new Set(['8-K', '8-K/A', '10-Q', '10-Q/A', '10-K', '10-K/A']);
const MIN_SENTENCE_WORDS = 6;

/**
 * The first sentence of the stored 10-K business section, as filed: headings, the "Item 1. Business" line and the
 * forward-looking statements notice are skipped. Null when no sentence of at least six words is found.
 */
export function firstBusinessSentence(text: string): string | null {
  for (const line of cleanSectionLines(text)) {
    if (line.context === line.text) continue; // a heading
    if (/^(part\s+i\b|item\s+1\b)/i.test(line.text)) continue;
    if (/forward-looking statements/i.test(line.text)) continue;
    const first = splitRiskSentences(line.text)[0];
    if (!first || !/[.!?]["'’”)]?$/.test(first)) continue;
    if ((first.match(/[\p{L}\p{N}]+/gu) ?? []).length < MIN_SENTENCE_WORDS) continue;
    return first;
  }
  return null;
}

/** The return over the last `sessions` bars, and SPY's and the sector fund's over the same two dates. */
export function periodReturn(
  bars: readonly DailyBar[],
  sessions: number,
  spy: readonly DailyBar[] | null,
  sector: readonly DailyBar[] | null,
): PeriodReturn | null {
  const end = bars[bars.length - 1];
  const start = bars[bars.length - 1 - sessions];
  if (!end || !start || !(start.close > 0)) return null;
  const over = (b: readonly DailyBar[] | null): number | null => {
    if (!b) return null;
    const s = b.find((x) => x.date === start.date)?.close;
    const e = b.find((x) => x.date === end.date)?.close;
    return s !== undefined && e !== undefined && s > 0 ? e / s - 1 : null;
  };
  return {
    sessions,
    from: start.date,
    to: end.date,
    stock: end.close / start.close - 1,
    spy: over(spy),
    sector: over(sector),
  };
}

/** True when an ISO instant falls on one of the `days` ET calendar days ending on `asOf`. */
const within = (iso: string, asOf: string, days: number): boolean => {
  const d = daysBetween(etDate(new Date(iso)), asOf);
  return d >= 0 && d < days;
};

const withinDate = (date: string, asOf: string, days: number): boolean => {
  const d = daysBetween(date, asOf);
  return d >= 0 && d < days;
};

export function companyBrief(x: CompanyBriefInput): CompanyBrief {
  const R = BRIEF_RULES;
  const last = x.bars[x.bars.length - 1] ?? null;
  const close = last ? last.close : null;
  const snap = x.facts ? companySnapshot(x.facts, x.asOf, close) : null;
  const inv = x.facts ? investorView(x.facts, x.asOf, close) : null;
  const trader = last ? traderMetrics(x.bars, x.spy ?? [], x.sector?.bars ?? null) : null;

  // Company.
  const sentence = x.business ? firstBusinessSentence(x.business.text) : null;
  const whatItDoes =
    x.business && sentence
      ? {
          sentence,
          filingDate: x.business.filingDate,
          periodEnd: x.business.periodEnd,
          filingUrl: x.business.filingUrl,
        }
      : null;
  const marketValue =
    snap?.marketValue != null && snap.sharesOutstanding && last
      ? {
          value: snap.marketValue,
          close: last.close,
          priceDate: last.date,
          shares: snap.sharesOutstanding.value,
          sharesDate: snap.sharesOutstanding.end,
        }
      : null;

  // Performance.
  const spy = x.spy;
  const sec = x.sector?.bars ?? null;
  const returns = {
    m1: periodReturn(x.bars, BRIEF_PERIODS.m1, spy, sec),
    m3: periodReturn(x.bars, BRIEF_PERIODS.m3, spy, sec),
    y1: periodReturn(x.bars, BRIEF_PERIODS.y1, spy, sec),
  };
  const revenue =
    snap?.revenueTtm?.value != null && snap.revenueTtmEnd
      ? { value: snap.revenueTtm.value, end: snap.revenueTtmEnd, yoyPct: snap.revenueTtmYoYPct }
      : null;
  const netMargin =
    snap?.netMarginTtmPct != null && snap.revenueTtmEnd
      ? { pct: snap.netMarginTtmPct, end: snap.revenueTtmEnd }
      : null;
  const fcfM = inv?.ttm.freeCashFlow;
  const freeCashFlow =
    fcfM?.value != null && fcfM.filed ? { value: fcfM.value, filed: fcfM.filed } : null;
  // investor-1 gives the change; the quarter it ends on is read the same way, for its date only.
  const dilutionEnd =
    inv?.dilutionYoYPct != null && x.facts
      ? quarterlyValues(
          preferConcepts(
            pointInTime(x.facts, x.asOf),
            ['WeightedAverageNumberOfDilutedSharesOutstanding'],
            'shares',
          ),
        )
          .filter((q) => !q.derived)
          .at(-1)?.end
      : undefined;
  const dilution =
    inv?.dilutionYoYPct != null && dilutionEnd
      ? { pct: inv.dilutionYoYPct, end: dilutionEnd }
      : null;
  const strength = x.strength;

  // Sentiment.
  let news: CompanyBrief['sentiment']['news'] = null;
  if (x.news) {
    const seen = new Set<string>();
    let positive = 0;
    let neutral = 0;
    let negative = 0;
    let unlabelled = 0;
    let stored = false;
    for (const a of x.news) {
      if (seen.has(a.id) || !within(a.publishedAt, x.asOf, R.newsDays)) continue;
      seen.add(a.id);
      if (a.sentiment && a.sentiment.length > 0) stored = true;
      const label = a.sentiment?.find((s) => s.ticker === x.ticker)?.label.toLowerCase();
      if (label === 'positive') positive++;
      else if (label === 'neutral') neutral++;
      else if (label === 'negative') negative++;
      else unlabelled++;
    }
    const labelled = positive + neutral + negative;
    news = {
      days: R.newsDays,
      stories: seen.size,
      positive,
      neutral,
      negative,
      unlabelled,
      stored,
      capped: x.newsCapped === true,
      pct:
        labelled >= R.minStories
          ? {
              positive: (positive / labelled) * 100,
              neutral: (neutral / labelled) * 100,
              negative: (negative / labelled) * 100,
            }
          : null,
    };
  }

  let insiders: CompanyBrief['sentiment']['insiders'] = null;
  if (x.insiders) {
    let buys = 0;
    let sells = 0;
    let buyUsd = 0;
    let sellUsd = 0;
    let unpriced = 0;
    for (const r of x.insiders) {
      if (r.isAmendment || r.table !== 'non-derivative') continue;
      if (!withinDate(r.date, x.asOf, R.insiderDays)) continue;
      // Open-market purchases (P, acquired) and sales (S, disposed) only; grants and option exercises are pay.
      const buy = r.code === 'P' && r.acquiredDisposed === 'A';
      const sell = r.code === 'S' && r.acquiredDisposed === 'D';
      if (!buy && !sell) continue;
      if (buy) buys++;
      else sells++;
      if (r.valueUsd === null) unpriced++;
      else if (buy) buyUsd += r.valueUsd;
      else sellUsd += r.valueUsd;
    }
    insiders = {
      days: R.insiderDays,
      buys,
      sells,
      buyUsd,
      sellUsd,
      netUsd: buyUsd - sellUsd,
      unpriced,
    };
  }

  let short: CompanyBrief['sentiment']['short'] = null;
  const sorted = [...(x.shortInterest ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  const latest = sorted[0];
  const prev = sorted[1];
  if (latest) {
    const out = inv?.sharesOutstanding?.metric.value;
    short = {
      date: latest.date,
      shares: latest.shortInterest,
      daysToCover: latest.daysToCover,
      pctOfShares: out && out > 0 ? (latest.shortInterest / out) * 100 : null,
      prior:
        prev && prev.shortInterest > 0
          ? {
              date: prev.date,
              shares: prev.shortInterest,
              changePct: (latest.shortInterest / prev.shortInterest - 1) * 100,
            }
          : null,
    };
  }

  // Context: plain statements with dates, never an outlook.
  const regime = x.regime
    ? { label: x.regime.label, date: x.regime.date, ruleVersion: x.regime.ruleVersion }
    : null;
  const recession = x.regime
    ? {
        level: x.regime.recessionLevel,
        triggered: x.regime.triggered,
        available: x.regime.available,
        date: x.regime.date,
        version: x.regime.recessionVersion,
      }
    : null;
  let sector: CompanyBrief['context']['sector'] = null;
  if (x.sector && spy) {
    const spyDates = new Set(spy.map((b) => b.date));
    const date = [...x.sector.bars].reverse().find((b) => spyDates.has(b.date))?.date;
    if (date)
      sector = {
        ticker: x.sector.ticker,
        rs1m: relativeStrength(x.sector.bars, spy, BRIEF_PERIODS.m1),
        rs3m: relativeStrength(x.sector.bars, spy, BRIEF_PERIODS.m3),
        date,
      };
  }

  // Latest filing and what comes next.
  const latestReport =
    x.filings
      ?.filter((f) => REPORT_FORMS.has(f.form) && f.filingDate <= x.asOf)
      .sort((a, b) => b.filingDate.localeCompare(a.filingDate))[0] ?? null;
  const riskFactors = x.riskFactors
    ? {
        filingDate: x.riskFactors.filingDate,
        changed: !x.riskFactors.noMaterialChanges,
        filingUrl: x.riskFactors.filingUrl,
      }
    : null;
  const earnings = x.earnings
    ? { ...x.earnings, daysAway: daysBetween(x.asOf, x.earnings.date) }
    : null;
  const nextDiv =
    x.dividends
      ?.filter((d) => d.exDividendDate >= x.asOf)
      .sort((a, b) => a.exDividendDate.localeCompare(b.exDividendDate))[0] ?? null;
  const exDividend = nextDiv
    ? { date: nextDiv.exDividendDate, cashAmount: nextDiv.cashAmount, currency: nextDiv.currency }
    : null;
  const recent = <T>(list: readonly T[] | null, at: (v: T) => string) => {
    if (!list) return null;
    const hits = list
      .filter((v) => within(at(v), x.asOf, R.eventDays))
      .sort((a, b) => at(b).localeCompare(at(a)));
    return { count: hits.length, newest: hits[0] ?? null, days: R.eventDays };
  };
  const halts = recent(x.halts, (h) => h.haltedAt);
  const alerts = recent(x.alerts, (a) => a.createdAt);

  // Rule-based checks: only rules whose inputs exist fire.
  const checks: BriefCheck[] = [];
  const add = (c: BriefCheck) => checks.push(c);
  if (revenue?.yoyPct != null) {
    if (revenue.yoyPct >= R.revenueGrowthPct)
      add({
        id: 'revenue-growth',
        side: 'strength',
        value: revenue.yoyPct,
        threshold: R.revenueGrowthPct,
        date: revenue.end,
      });
    else if (revenue.yoyPct < 0)
      add({
        id: 'revenue-decline',
        side: 'risk',
        value: revenue.yoyPct,
        threshold: 0,
        date: revenue.end,
      });
  }
  if (netMargin) {
    if (netMargin.pct >= R.netMarginPct)
      add({
        id: 'net-margin',
        side: 'strength',
        value: netMargin.pct,
        threshold: R.netMarginPct,
        date: netMargin.end,
      });
    else if (netMargin.pct < 0)
      add({
        id: 'net-loss',
        side: 'risk',
        value: netMargin.pct,
        threshold: 0,
        date: netMargin.end,
      });
  }
  const bal = inv?.balance;
  if (bal?.netCash != null)
    add({
      id: bal.netCash >= 0 ? 'net-cash' : 'net-debt',
      side: bal.netCash >= 0 ? 'strength' : 'risk',
      value: bal.netCash,
      threshold: null,
      date: bal.end,
    });
  if (freeCashFlow)
    add({
      id: freeCashFlow.value >= 0 ? 'fcf-positive' : 'fcf-negative',
      side: freeCashFlow.value >= 0 ? 'strength' : 'risk',
      value: freeCashFlow.value,
      threshold: null,
      date: freeCashFlow.filed,
    });
  if (dilution) {
    if (dilution.pct >= R.dilutionPct)
      add({
        id: 'dilution',
        side: 'risk',
        value: dilution.pct,
        threshold: R.dilutionPct,
        date: dilution.end,
      });
    else if (dilution.pct <= R.shrinkPct)
      add({
        id: 'shares-shrinking',
        side: 'strength',
        value: dilution.pct,
        threshold: R.shrinkPct,
        date: dilution.end,
      });
  }
  if (last) {
    const avg = sma(
      x.bars.map((b) => b.close),
      200,
    ).at(-1);
    if (avg != null)
      add({
        id: last.close > avg ? 'above-200' : 'below-200',
        side: last.close > avg ? 'strength' : 'risk',
        value: last.close,
        threshold: null,
        date: last.date,
        extra: avg,
      });
  }
  if (trader?.rsSpy != null && x.spy) {
    const pct = trader.rsSpy * 100;
    if (pct >= R.rsSpyPct)
      add({
        id: 'beats-spy',
        side: 'strength',
        value: pct,
        threshold: R.rsSpyPct,
        date: trader.asOf,
      });
    else if (pct <= -R.rsSpyPct)
      add({ id: 'lags-spy', side: 'risk', value: pct, threshold: -R.rsSpyPct, date: trader.asOf });
  }
  if (strength) {
    if (strength.percentile >= R.strengthTop)
      add({
        id: 'strength-top',
        side: 'strength',
        value: strength.percentile,
        threshold: R.strengthTop,
        date: strength.date,
        extra: strength.members,
      });
    else if (strength.percentile <= R.strengthBottom)
      add({
        id: 'strength-bottom',
        side: 'risk',
        value: strength.percentile,
        threshold: R.strengthBottom,
        date: strength.date,
        extra: strength.members,
      });
  }
  if (trader?.fromHigh != null && trader.fromHigh * 100 <= R.fromHighPct)
    add({
      id: 'far-from-high',
      side: 'risk',
      value: trader.fromHigh * 100,
      threshold: R.fromHighPct,
      date: trader.asOf,
    });
  if (short?.pctOfShares != null && short.pctOfShares >= R.shortInterestPct)
    add({
      id: 'short-interest',
      side: 'risk',
      value: short.pctOfShares,
      threshold: R.shortInterestPct,
      date: short.date,
    });
  if (insiders) {
    if (insiders.buys > 0)
      add({
        id: 'insider-buying',
        side: 'strength',
        value: insiders.buyUsd,
        threshold: null,
        date: x.asOf,
        extra: insiders.buys,
      });
    else if (insiders.sells > 0)
      add({
        id: 'insider-selling',
        side: 'risk',
        value: insiders.sellUsd,
        threshold: null,
        date: x.asOf,
        extra: insiders.sells,
      });
  }
  if (earnings && earnings.daysAway >= 0 && earnings.daysAway <= R.earningsDays)
    add({
      id: 'earnings-soon',
      side: 'risk',
      value: earnings.daysAway,
      threshold: R.earningsDays,
      date: earnings.date,
    });
  if (halts?.newest)
    add({
      id: 'recent-halt',
      side: 'risk',
      value: halts.count,
      threshold: null,
      date: etDate(new Date(halts.newest.haltedAt)),
    });

  return {
    ticker: x.ticker,
    asOf: x.asOf,
    formulaVersion: COMPANY_BRIEF_VERSION,
    versions: {
      snapshot: SNAPSHOT_VERSION,
      investor: INVESTOR_VERSION,
      trader: TRADER_VERSION,
      strength: STRENGTH_VERSION,
    },
    company: { name: x.name, whatItDoes, marketValue },
    performance: {
      close: last ? { value: last.close, date: last.date } : null,
      returns,
      sectorTicker: x.sector?.ticker ?? null,
      revenue,
      netMargin,
      freeCashFlow,
      dilution,
      strength,
    },
    checks,
    sentiment: { news, insiders, short },
    context: { regime, sector, recession },
    next: { latestReport, riskFactors, earnings, exDividend, halts, alerts },
  };
}
