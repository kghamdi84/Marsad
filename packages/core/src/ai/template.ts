/**
 * Deterministic text built by code from the facts. This is what the user sees when the model is off, capped
 * or fails verification, so it must always pass the verifier: figures are formatted to match their fact, and
 * every sentence cites the fact it states.
 */
import type { Fact, Payload } from './facts.js';

/**
 * Fixed-decimal text that rounds a half up, the way a person rounds money. `Number.prototype.toFixed` works on
 * the binary value, so it turns 81.615 into "81.61", 1.005 into "1.00" and 2.675 into "2.67". Shifting the
 * decimal point in the text first keeps the exact decimal that was written.
 */
export function toFixedHalfUp(n: number, decimals: number): string {
  const abs = Math.abs(n);
  const written = String(abs);
  if (written.includes('e')) return n.toFixed(decimals); // very large or very small: no safe text shift
  const shifted = Math.round(Number(`${written}e${decimals}`));
  const text = Number(`${shifted}e-${decimals}`).toFixed(decimals);
  return n < 0 && Number(text) !== 0 ? `-${text}` : text;
}

function trimmed(n: number, decimals: number): string {
  return toFixedHalfUp(n, decimals).replace(/\.?0+$/, (m) => (m.startsWith('.') ? '' : m));
}

function withCommas(n: number, decimals = 0): string {
  const [whole, frac] = toFixedHalfUp(Math.abs(n), decimals).split('.');
  const grouped = (whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${n < 0 ? '-' : ''}${grouped}${frac ? `.${frac}` : ''}`;
}

/** A number as text that the verifier will accept for the same fact. Text and null facts come back as written. */
export function formatFactValue(fact: Fact): string {
  const v = fact.value;
  if (v === null) return 'not available';
  if (typeof v === 'string') return v;
  switch (fact.unit) {
    case 'pct':
      return `${trimmed(v, 1)}%`;
    case 'ratio':
      return `${trimmed(v, 1)}x`;
    case 'usd': {
      const abs = Math.abs(v);
      const sign = v < 0 ? '-' : '';
      if (abs >= 1e12) return `${sign}$${trimmed(abs / 1e12, 2)}T`;
      if (abs >= 1e9) return `${sign}$${trimmed(abs / 1e9, 2)}B`;
      if (abs >= 1e6) return `${sign}$${trimmed(abs / 1e6, 2)}M`;
      return `${sign}$${withCommas(abs, 2)}`;
    }
    case 'shares':
    case 'count':
      return withCommas(v, Number.isInteger(v) ? 0 : 2);
    default:
      return String(v);
  }
}

/** One sentence per fact: "Label: value [F1]." */
export function factSentence(fact: Fact): string {
  return `${fact.label}: ${formatFactValue(fact)} [${fact.id}].`;
}

/** Lists every fact, one sentence each, in payload order. */
export function factsTemplate(payload: Payload, heading?: string): string {
  const lines = payload.facts.map(factSentence);
  return heading ? [heading, ...lines].join('\n') : lines.join('\n');
}
