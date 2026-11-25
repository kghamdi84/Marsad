/**
 * Options positions entered by hand (options-pos-1, ADR 0034). Pure: what code can say from the legs, the stored
 * underlying close and the calendar. Live option prices need the options data plan, so the current value of a
 * position is never estimated here; the view says so instead.
 */
import { payoffAt, payoffSummary, type Leg, type OptionType } from './options.js';
import { toFixedHalfUp } from './ai/template.js';

export const OPTION_POSITIONS_VERSION = 'options-pos-1';

export interface OptionLeg {
  type: OptionType;
  strike: number;
  /** Contracts: positive long, negative short. */
  qty: number;
  /** Premium per share at entry. */
  price: number;
}

export interface OptionPosition {
  underlying: string;
  label: string;
  /** One expiry for every leg (ISO date); calendars and diagonals are not supported in this version. */
  expiry: string;
  legs: OptionLeg[];
  openedOn: string;
  /** Close when this many calendar days remain, or null. */
  exitDte: number | null;
  /** Take profit at this share of the maximum gain (0.5 is 50%), or null. */
  profitTakePct: number | null;
  /** Cut the loss at this share of the maximum loss, or null. */
  lossLimitPct: number | null;
  bearCase: string;
}

export const MAX_LEGS = 4;

/** Every reason the position cannot be stored; empty when it can. Undefined-risk structures are refused. */
export function validateOptionPosition(p: OptionPosition, today: string): string[] {
  const e: string[] = [];
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(p.underlying)) e.push('Underlying ticker is not valid.');
  if (p.label.trim() === '') e.push('Name the position (for example, "Bull call spread").');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.expiry)) e.push('Expiry must be a date (YYYY-MM-DD).');
  else if (p.expiry < today) e.push('Expiry is in the past.');
  if (p.legs.length < 1 || p.legs.length > MAX_LEGS) e.push(`Enter 1 to ${MAX_LEGS} legs.`);
  p.legs.forEach((l, i) => {
    if (!(l.strike > 0)) e.push(`Leg ${i + 1}: strike must be above 0.`);
    if (!Number.isInteger(l.qty) || l.qty === 0)
      e.push(`Leg ${i + 1}: contracts must be a whole number, not 0.`);
    if (!(l.price >= 0)) e.push(`Leg ${i + 1}: premium must be 0 or more.`);
  });
  if (p.exitDte === null && p.profitTakePct === null && p.lossLimitPct === null)
    e.push('Write at least one exit rule: days to expiry, a profit take or a loss limit.');
  if (p.exitDte !== null && !(Number.isInteger(p.exitDte) && p.exitDte >= 0))
    e.push('Exit days to expiry must be a whole number, 0 or more.');
  for (const [name, v] of [
    ['Profit take', p.profitTakePct],
    ['Loss limit', p.lossLimitPct],
  ] as const)
    if (v !== null && !(v > 0 && v <= 1)) e.push(`${name} must be above 0% and at most 100%.`);
  if (p.bearCase.trim() === '') e.push('Write the bear case: what makes this position lose.');
  if (e.length === 0 && !payoffSummary(toLegs(p.legs)).definedRisk)
    e.push('The maximum loss is unlimited. Marsad tracks defined-risk positions only.');
  return e;
}

const toLegs = (legs: readonly OptionLeg[]): Leg[] => legs.map((l) => ({ ...l }));

/** Calendar days from `today` to `expiry` (both ISO dates); 0 on the expiry date. */
export function daysToExpiry(expiry: string, today: string): number {
  return Math.round(
    (Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
}

export interface OptionPositionView {
  /** Premium paid (positive, a debit) or received (negative, a credit), in dollars. */
  netPremium: number;
  maxLoss: number;
  maxGain: number | null;
  breakevens: number[];
  dte: number;
  /** Profit at expiry if the underlying finished at the last stored close; null without a close. */
  atExpiryIfUnchanged: number | null;
  close: { value: number; asOf: string } | null;
  /** Always null in this version: option quotes need the options data plan. */
  currentValue: null;
}

export function optionPositionView(
  p: OptionPosition,
  close: { value: number; asOf: string } | null,
  today: string,
): OptionPositionView {
  const legs = toLegs(p.legs);
  const s = payoffSummary(legs);
  return {
    netPremium: p.legs.reduce((sum, l) => sum + l.qty * 100 * l.price, 0),
    maxLoss: s.maxLoss ?? Number.NEGATIVE_INFINITY,
    maxGain: s.maxGain,
    breakevens: s.breakevens,
    dte: daysToExpiry(p.expiry, today),
    atExpiryIfUnchanged: close === null ? null : payoffAt(legs, close.value),
    close,
    currentValue: null,
  };
}

export interface OptionExitSignal {
  rule: 'time' | 'expired' | 'assignment' | 'profit-take' | 'loss-limit';
  /** True when code can say the rule is met now; false when it can only restate the rule. */
  met: boolean;
  text: string;
}

const usd = (v: number) => `${v < 0 ? '-' : ''}$${toFixedHalfUp(Math.abs(v), 2)}`;

/**
 * The position's exit rules against what is known: the time exit and expiry from the calendar, assignment risk
 * from a short leg in the money at the last close within 7 days of expiry. Profit take and loss limit need the
 * position's current value, so they are restated with their dollar levels, never judged.
 */
export function optionExitSignals(p: OptionPosition, v: OptionPositionView): OptionExitSignal[] {
  const out: OptionExitSignal[] = [];
  if (v.dte < 0)
    out.push({
      rule: 'expired',
      met: true,
      text: `Expired ${-v.dte} days ago: record how it closed.`,
    });
  else if (p.exitDte !== null)
    out.push({
      rule: 'time',
      met: v.dte <= p.exitDte,
      text:
        v.dte <= p.exitDte
          ? `Time exit: ${v.dte} days to expiry; your rule says close at ${p.exitDte}.`
          : `Time exit at ${p.exitDte} days to expiry (now ${v.dte}).`,
    });
  if (v.close !== null && v.dte >= 0 && v.dte <= 7)
    for (const l of p.legs)
      if (l.qty < 0) {
        const itm = l.type === 'call' ? v.close.value > l.strike : v.close.value < l.strike;
        if (itm)
          out.push({
            rule: 'assignment',
            met: true,
            text: `Assignment risk: the short ${l.strike} ${l.type} is in the money at the ${v.close.asOf} close (${toFixedHalfUp(v.close.value, 2)}) with ${v.dte} days left.`,
          });
      }
  if (p.profitTakePct !== null && v.maxGain !== null)
    out.push({
      rule: 'profit-take',
      met: false,
      text: `Profit take at ${toFixedHalfUp(p.profitTakePct * 100, 0)}% of the maximum gain (${usd(p.profitTakePct * v.maxGain)}); needs option quotes to judge.`,
    });
  if (p.lossLimitPct !== null)
    out.push({
      rule: 'loss-limit',
      met: false,
      text: `Loss limit at ${toFixedHalfUp(p.lossLimitPct * 100, 0)}% of the maximum loss (${usd(p.lossLimitPct * v.maxLoss)}); needs option quotes to judge.`,
    });
  return out;
}
