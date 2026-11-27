/**
 * A `rule-dsl-1` document as plain lines for people (rule-text-1): what the Lab shows next to the stored JSON. Pure
 * and lossless for every field the evaluator reads (operators keep their DSL names, offsets and stops are spelled
 * out), so the text never says something the rule does not do.
 */
import type { RuleCondition, RuleDoc, RuleExpr } from './rules.js';

export const RULE_TEXT_VERSION = 'rule-text-1';

const ago = (offset?: number) =>
  offset ? `${offset} bar${offset === 1 ? '' : 's'} ago` : undefined;

/** One expression: `close`, `sma(200)`, `highest(close, 252)`, `sma(200, 20 bars ago)`, `0.75 × highest(...)`. */
export function ruleExprText(e: RuleExpr): string {
  if (typeof e === 'number') return String(e);
  if (e.ind === 'mul') return `${ruleExprText(e.left)} × ${ruleExprText(e.right)}`;
  if (!('period' in e)) {
    const a = ago(e.offset);
    return a ? `${e.ind}(${a})` : e.ind;
  }
  const args: string[] = [];
  if ('of' in e && e.of) args.push(e.of);
  args.push(String(e.period));
  const a = ago(e.offset);
  if (a) args.push(a);
  return `${e.ind}(${args.join(', ')})`;
}

function conditionLines(c: RuleCondition, indent: string): string[] {
  if ('all' in c)
    return ['all of:', ...c.all.flatMap((x) => conditionLines(x, '').map((l) => `  ${l}`))].map(
      (l) => indent + l,
    );
  if ('any' in c)
    return ['any of:', ...c.any.flatMap((x) => conditionLines(x, '').map((l) => `  ${l}`))].map(
      (l) => indent + l,
    );
  if ('not' in c)
    return ['not:', ...conditionLines(c.not, '').map((l) => `  ${l}`)].map((l) => indent + l);
  return [`${indent}${ruleExprText(c.left)} ${c.op} ${ruleExprText(c.right)}`];
}

/** Labels padded to one width so the conditions line up, as in the Lab design. */
function labelled(label: string, c: RuleCondition): string[] {
  const [first = '', ...rest] = conditionLines(c, '');
  const head = `${label}:`.padEnd(7);
  return [head + first, ...rest.map((l) => ' '.repeat(7) + l)];
}

/** The rule as lines: entry, exit, stop and time stop, in the order the backtester applies them. */
export function ruleLines(rule: RuleDoc): string[] {
  const out = labelled('entry', rule.entry);
  if (rule.exit) out.push(...labelled('exit', rule.exit));
  if (rule.stop)
    out.push(
      'pct' in rule.stop
        ? `stop:  ${Math.round(rule.stop.pct * 10_000) / 100}% below entry`
        : `stop:  ${rule.stop.atr} × atr(14) below entry`,
    );
  if (rule.maxHoldBars !== undefined) out.push(`time:  exit after ${rule.maxHoldBars} bars`);
  return out;
}
