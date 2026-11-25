/**
 * Rule documents and their evaluator (ADR 0016, `rule-dsl-1`). A rule is a JSON document: entry and exit conditions
 * built from comparisons of indicator expressions, an optional stop and a time stop. The evaluator reads only bars
 * up to the one it judges (completed bars), so a signal can never depend on later data; the backtester enters on the
 * next bar's open. Pure: the same rule and bars give the same signals on every runtime.
 */
import { atr, ema, rsi, rvol, sma, type Series } from './indicators.js';
import type { DailyBar } from './study.js';

export const RULE_DSL_VERSION = 'rule-dsl-1';

export type BarField = 'open' | 'high' | 'low' | 'close' | 'volume';

/** An indicator or price value at a bar, optionally `offset` bars earlier. */
export type RuleExpr =
  | number
  | { ind: BarField; offset?: number }
  | {
      ind: 'sma' | 'ema' | 'highest' | 'lowest' | 'return';
      period: number;
      of?: BarField;
      offset?: number;
    }
  | { ind: 'rsi' | 'atr' | 'rvol'; period: number; offset?: number }
  | { ind: 'mul'; left: RuleExpr; right: RuleExpr };

export type RuleOp = '>' | '>=' | '<' | '<=' | 'crossesAbove' | 'crossesBelow';

export type RuleCondition =
  | { all: RuleCondition[] }
  | { any: RuleCondition[] }
  | { not: RuleCondition }
  | { left: RuleExpr; op: RuleOp; right: RuleExpr };

export interface RuleDoc {
  id: string;
  name: string;
  side: 'long';
  entry: RuleCondition;
  /** Exit at the next open after this holds; absent means only the stop or time stop exits. */
  exit?: RuleCondition;
  /** Protective stop below the entry price: a fraction (0.08 is 8%) or a multiple of ATR(14) at entry. */
  stop?: { pct: number } | { atr: number };
  /** Exit at the next open after this many bars in the trade. */
  maxHoldBars?: number;
}

const FIELDS = new Set(['open', 'high', 'low', 'close', 'volume']);
const OPS = new Set(['>', '>=', '<', '<=', 'crossesAbove', 'crossesBelow']);
const MAX_PERIOD = 400;
const MAX_DEPTH = 12;

/** Problems with a rule document, as readable messages; empty when it is valid. */
export function validateRule(doc: unknown): string[] {
  const errs: string[] = [];
  const isObj = (x: unknown): x is Record<string, unknown> =>
    typeof x === 'object' && x !== null && !Array.isArray(x);
  const period = (p: unknown, at: string) => {
    if (typeof p !== 'number' || !Number.isInteger(p) || p < 1 || p > MAX_PERIOD)
      errs.push(`${at}: period must be a whole number from 1 to ${MAX_PERIOD}`);
  };
  const offset = (o: unknown, at: string) => {
    if (
      o !== undefined &&
      (typeof o !== 'number' || !Number.isInteger(o) || o < 0 || o > MAX_PERIOD)
    )
      errs.push(`${at}: offset must be a whole number from 0 to ${MAX_PERIOD}`);
  };
  const expr = (e: unknown, at: string, depth: number): void => {
    if (depth > MAX_DEPTH) {
      errs.push(`${at}: nested too deeply`);
      return;
    }
    if (typeof e === 'number') {
      if (!Number.isFinite(e)) errs.push(`${at}: not a finite number`);
      return;
    }
    if (!isObj(e) || typeof e['ind'] !== 'string') {
      errs.push(`${at}: expected a number or an indicator`);
      return;
    }
    const ind = e['ind'];
    if (FIELDS.has(ind)) offset(e['offset'], at);
    else if (['sma', 'ema', 'highest', 'lowest', 'return'].includes(ind)) {
      period(e['period'], at);
      offset(e['offset'], at);
      if (e['of'] !== undefined && !FIELDS.has(String(e['of'])))
        errs.push(`${at}: unknown field ${String(e['of'])}`);
    } else if (['rsi', 'atr', 'rvol'].includes(ind)) {
      period(e['period'], at);
      offset(e['offset'], at);
    } else if (ind === 'mul') {
      expr(e['left'], `${at}.left`, depth + 1);
      expr(e['right'], `${at}.right`, depth + 1);
    } else errs.push(`${at}: unknown indicator ${ind}`);
  };
  const cond = (c: unknown, at: string, depth: number): void => {
    if (depth > MAX_DEPTH) {
      errs.push(`${at}: nested too deeply`);
      return;
    }
    if (!isObj(c)) {
      errs.push(`${at}: expected a condition`);
      return;
    }
    if (Array.isArray(c['all']) || Array.isArray(c['any'])) {
      const list = (c['all'] ?? c['any']) as unknown[];
      if (list.length === 0) errs.push(`${at}: empty list`);
      list.forEach((x, i) => cond(x, `${at}[${i}]`, depth + 1));
    } else if ('not' in c) cond(c['not'], `${at}.not`, depth + 1);
    else {
      if (!OPS.has(String(c['op']))) errs.push(`${at}: unknown operator ${String(c['op'])}`);
      expr(c['left'], `${at}.left`, depth + 1);
      expr(c['right'], `${at}.right`, depth + 1);
    }
  };
  if (!isObj(doc)) return ['rule: expected an object'];
  if (typeof doc['id'] !== 'string' || !/^[a-z0-9][a-z0-9-]{1,59}$/.test(doc['id']))
    errs.push('id: lower-case letters, digits and hyphens, 2 to 60 characters');
  if (typeof doc['name'] !== 'string' || doc['name'].length === 0) errs.push('name: required');
  if (doc['side'] !== 'long') errs.push('side: only long rules are supported');
  cond(doc['entry'], 'entry', 0);
  if (doc['exit'] !== undefined) cond(doc['exit'], 'exit', 0);
  const stop = doc['stop'];
  if (stop !== undefined) {
    if (!isObj(stop)) errs.push('stop: expected { pct } or { atr }');
    else if (typeof stop['pct'] === 'number') {
      if (!(stop['pct'] > 0 && stop['pct'] < 1)) errs.push('stop.pct: between 0 and 1');
    } else if (typeof stop['atr'] === 'number') {
      if (!(stop['atr'] > 0 && stop['atr'] <= 20)) errs.push('stop.atr: above 0, at most 20');
    } else errs.push('stop: expected { pct } or { atr }');
  }
  const hold = doc['maxHoldBars'];
  if (
    hold !== undefined &&
    (typeof hold !== 'number' || !Number.isInteger(hold) || hold < 1 || hold > 2520)
  )
    errs.push('maxHoldBars: a whole number from 1 to 2520');
  if (doc['exit'] === undefined && stop === undefined && hold === undefined)
    errs.push('exit: a rule needs an exit condition, a stop or a time stop');
  return errs;
}

/** A stable text form of a rule (keys sorted), for hashing and storing immutable versions. */
export function canonicalRule(doc: RuleDoc): string {
  const sort = (x: unknown): unknown =>
    Array.isArray(x)
      ? x.map(sort)
      : typeof x === 'object' && x !== null
        ? Object.fromEntries(
            Object.keys(x)
              .sort()
              .map((k) => [k, sort((x as Record<string, unknown>)[k])]),
          )
        : x;
  return JSON.stringify(sort(doc));
}

/** FNV-1a 32-bit hash of the canonical form, as 8 hex digits (identifies a rule version's content). */
export function ruleHash(doc: RuleDoc): string {
  let h = 0x811c9dc5;
  for (const ch of canonicalRule(doc)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Rolling highest or lowest of the last `period` values (including the bar). */
function rolling(values: readonly number[], period: number, pick: 'max' | 'min'): Series {
  const out: Series = new Array<number | null>(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let v = values[i] as number;
    for (let j = i - period + 1; j < i; j++) {
      const x = values[j] as number;
      v = pick === 'max' ? Math.max(v, x) : Math.min(v, x);
    }
    out[i] = v;
  }
  return out;
}

/** Evaluates rules on one ticker's bars, computing each indicator series once. */
export class RuleEvaluator {
  private readonly cache = new Map<string, Series>();
  private readonly cols: Record<BarField, number[]>;

  constructor(private readonly bars: readonly DailyBar[]) {
    this.cols = {
      open: bars.map((b) => b.open),
      high: bars.map((b) => b.high),
      low: bars.map((b) => b.low),
      close: bars.map((b) => b.close),
      volume: bars.map((b) => b.volume),
    };
  }

  private series(e: Exclude<RuleExpr, number | { ind: 'mul' }>): Series {
    const key = JSON.stringify({ ...e, offset: 0 });
    const hit = this.cache.get(key);
    if (hit) return hit;
    const c = this.cols;
    let s: Series;
    switch (e.ind) {
      case 'open':
      case 'high':
      case 'low':
      case 'close':
      case 'volume':
        s = c[e.ind];
        break;
      case 'sma':
        s = sma(c[e.of ?? 'close'], e.period);
        break;
      case 'ema':
        s = ema(c[e.of ?? 'close'], e.period);
        break;
      case 'highest':
        s = rolling(c[e.of ?? 'high'], e.period, 'max');
        break;
      case 'lowest':
        s = rolling(c[e.of ?? 'low'], e.period, 'min');
        break;
      case 'return': {
        const v = c[e.of ?? 'close'];
        s = v.map((x, i) =>
          i >= e.period && (v[i - e.period] as number) > 0
            ? x / (v[i - e.period] as number) - 1
            : null,
        );
        break;
      }
      case 'rsi':
        s = rsi(c.close, e.period);
        break;
      case 'atr':
        s = atr(c.high, c.low, c.close, e.period);
        break;
      case 'rvol':
        s = rvol(c.volume, e.period);
        break;
    }
    this.cache.set(key, s);
    return s;
  }

  /** The value of an expression at bar `i`, or null when it needs bars that do not exist. */
  value(e: RuleExpr, i: number): number | null {
    if (typeof e === 'number') return e;
    if (e.ind === 'mul') {
      const a = this.value(e.left, i);
      const b = this.value(e.right, i);
      return a === null || b === null ? null : a * b;
    }
    const j = i - (e.offset ?? 0);
    if (j < 0 || j > i) return null;
    return this.series(e)[j] ?? null;
  }

  /** Whether the condition holds at bar `i`; null when any value it needs is missing. */
  holds(c: RuleCondition, i: number): boolean | null {
    if ('all' in c) {
      let unknown = false;
      for (const x of c.all) {
        const r = this.holds(x, i);
        if (r === false) return false;
        if (r === null) unknown = true;
      }
      return unknown ? null : true;
    }
    if ('any' in c) {
      let unknown = false;
      for (const x of c.any) {
        const r = this.holds(x, i);
        if (r === true) return true;
        if (r === null) unknown = true;
      }
      return unknown ? null : false;
    }
    if ('not' in c) {
      const r = this.holds(c.not, i);
      return r === null ? null : !r;
    }
    const l = this.value(c.left, i);
    const r = this.value(c.right, i);
    if (l === null || r === null) return null;
    switch (c.op) {
      case '>':
        return l > r;
      case '>=':
        return l >= r;
      case '<':
        return l < r;
      case '<=':
        return l <= r;
      case 'crossesAbove':
      case 'crossesBelow': {
        if (i === 0) return null;
        const pl = this.value(c.left, i - 1);
        const pr = this.value(c.right, i - 1);
        if (pl === null || pr === null) return null;
        return c.op === 'crossesAbove' ? l > r && pl <= pr : l < r && pl >= pr;
      }
    }
  }

  /** The condition at every bar (true, false or null for not computable). */
  signals(c: RuleCondition): (boolean | null)[] {
    return this.bars.map((_, i) => this.holds(c, i));
  }
}
