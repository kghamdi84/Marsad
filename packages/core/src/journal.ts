/**
 * The trade journal (ADR 0024, `journal-1`): trades Khaled placed in Sahm, linked to the alert that prompted
 * them, with the Jimmy D adherence score (patience, process, strict risk, clean setups, taking profits, no
 * emotional bias) and statistics by setup. The score measures whether the written process was followed, not
 * whether the trade made money; the statistics then show whether following it paid. Pure.
 */
import { MIN_CASES } from './stats.js';
import { CHECKLIST, type ChecklistKey } from './portfolio.js';

export const JOURNAL_VERSION = 'journal-1';

/** What Khaled records about how the trade was run, beyond the pre-trade checklist. */
export type FollowedKey = 'stopPlaced' | 'sizedBySizer' | 'exitedPerPlan' | 'noEmotion';

export const FOLLOWED: readonly { key: FollowedKey; label: string; closedOnly: boolean }[] = [
  {
    key: 'stopPlaced',
    label: 'The stop was placed in Sahm when the order filled.',
    closedOnly: false,
  },
  {
    key: 'sizedBySizer',
    label: 'The size came from the sizer, not from a feeling.',
    closedOnly: false,
  },
  {
    key: 'exitedPerPlan',
    label: 'The exit followed the plan (stop, target, trend break or time stop).',
    closedOnly: true,
  },
  {
    key: 'noEmotion',
    label: 'No chasing, no revenge trade, no moving the stop away.',
    closedOnly: false,
  },
];

export interface JournalTrade {
  id: number;
  ticker: string;
  side: 'long' | 'short';
  setup: string;
  tags: string[];
  alertId: string | null;
  entryDate: string;
  entryPrice: number;
  shares: number;
  stop: number | null;
  target: number | null;
  exitDate: string | null;
  exitPrice: number | null;
  checklist: Partial<Record<ChecklistKey, boolean>>;
  followed: Partial<Record<FollowedKey, boolean>>;
  notes: string;
  screenshots: string[];
}

/** The six Jimmy D principles, each scored from recorded items. */
export const PRINCIPLES = [
  { key: 'patience', label: 'Patience', items: ['cleanSetup', 'notExtended'] },
  { key: 'process', label: 'Process', items: ['bearCaseRead', 'profitPlan'] },
  { key: 'risk', label: 'Strict risk', items: ['riskDefined', 'stopPlaced', 'sizedBySizer'] },
  { key: 'setups', label: 'Clean setups', items: ['setupNamed'] },
  { key: 'profits', label: 'Take profits', items: ['exitedPerPlan'] },
  { key: 'emotion', label: 'No emotional bias', items: ['noEmotion'] },
] as const;

export interface Adherence {
  /** 0 to 100: share of the applicable items honored. */
  score: number;
  honored: number;
  applicable: number;
  /** The items not honored, in plain words. */
  broken: string[];
  /** Each principle: items honored of those that apply (a principle with none applying is left out). */
  principles: { key: string; label: string; honored: number; applicable: number }[];
}

const LABEL: Record<string, string> = {
  ...Object.fromEntries(CHECKLIST.map((c) => [c.key, c.label])),
  ...Object.fromEntries(FOLLOWED.map((f) => [f.key, f.label])),
  setupNamed: 'The trade names a written setup.',
};

/**
 * The adherence score. Items: the five checklist items, the four "followed" items (the exit item only once the
 * trade is closed), and whether the trade names a setup. An item left unanswered counts as not honored.
 */
export function adherence(t: JournalTrade): Adherence {
  const closed = t.exitDate !== null;
  const items: { key: string; ok: boolean }[] = [
    ...CHECKLIST.map((c) => ({ key: c.key, ok: t.checklist[c.key] === true })),
    ...FOLLOWED.filter((f) => closed || !f.closedOnly).map((f) => ({
      key: f.key,
      ok: t.followed[f.key] === true,
    })),
    { key: 'setupNamed', ok: t.setup.trim() !== '' },
  ];
  const honored = items.filter((i) => i.ok).length;
  const ok = new Map(items.map((i) => [i.key, i.ok]));
  return {
    score: (100 * honored) / items.length,
    honored,
    applicable: items.length,
    broken: items.filter((i) => !i.ok).map((i) => LABEL[i.key] ?? i.key),
    principles: PRINCIPLES.flatMap((p) => {
      const apply = p.items.filter((k) => ok.has(k));
      return apply.length === 0
        ? []
        : [
            {
              key: p.key,
              label: p.label,
              honored: apply.filter((k) => ok.get(k)).length,
              applicable: apply.length,
            },
          ];
    }),
  };
}

/** Result in R (the initial risk): (exit - entry) / (entry - stop) for a long; null without a stop or an exit. */
export function rMultiple(t: JournalTrade): number | null {
  if (t.exitPrice === null || t.stop === null) return null;
  const risk = t.side === 'long' ? t.entryPrice - t.stop : t.stop - t.entryPrice;
  if (!(risk > 0)) return null;
  const move = t.side === 'long' ? t.exitPrice - t.entryPrice : t.entryPrice - t.exitPrice;
  return move / risk;
}

/** Realized result in USD; null while open. */
export function pnl(t: JournalTrade): number | null {
  if (t.exitPrice === null) return null;
  return (t.side === 'long' ? t.exitPrice - t.entryPrice : t.entryPrice - t.exitPrice) * t.shares;
}

export interface SetupStats {
  setup: string;
  closed: number;
  open: number;
  wins: number;
  winRate: number | null;
  /** Mean R over closed trades with a stop. */
  meanR: number | null;
  rCount: number;
  totalPnl: number;
  meanAdherence: number | null;
  insufficient: boolean;
}

const mean = (xs: readonly number[]) =>
  xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;

/** Statistics by setup (an empty setup is "Unnamed"), plus an "All trades" row first. */
export function statsBySetup(trades: readonly JournalTrade[]): SetupStats[] {
  const group = (name: string, ts: readonly JournalTrade[]): SetupStats => {
    const closed = ts.filter((t) => t.exitDate !== null);
    const rs = closed.map(rMultiple).filter((r): r is number => r !== null);
    const wins = closed.filter((t) => (pnl(t) ?? 0) > 0).length;
    return {
      setup: name,
      closed: closed.length,
      open: ts.length - closed.length,
      wins,
      winRate: closed.length ? wins / closed.length : null,
      meanR: mean(rs),
      rCount: rs.length,
      totalPnl: closed.reduce((a, t) => a + (pnl(t) ?? 0), 0),
      meanAdherence: mean(closed.map((t) => adherence(t).score)),
      insufficient: closed.length < MIN_CASES,
    };
  };
  const names = [...new Set(trades.map((t) => t.setup.trim() || 'Unnamed'))].sort();
  return [
    group('All trades', trades),
    ...names.map((n) =>
      group(
        n,
        trades.filter((t) => (t.setup.trim() || 'Unnamed') === n),
      ),
    ),
  ];
}

/**
 * Did following the process pay? Mean R of closed trades at or above an adherence score against those below it.
 * Both groups need 30 trades before the comparison means anything; until then it says so.
 */
export function adherenceVsResult(
  trades: readonly JournalTrade[],
  threshold = 80,
): {
  high: { n: number; meanR: number | null };
  low: { n: number; meanR: number | null };
  insufficient: boolean;
} {
  const closed = trades.filter((t) => t.exitDate !== null && rMultiple(t) !== null);
  const hi = closed.filter((t) => adherence(t).score >= threshold);
  const lo = closed.filter((t) => adherence(t).score < threshold);
  return {
    high: { n: hi.length, meanR: mean(hi.map((t) => rMultiple(t) as number)) },
    low: { n: lo.length, meanR: mean(lo.map((t) => rMultiple(t) as number)) },
    insufficient: hi.length < MIN_CASES || lo.length < MIN_CASES,
  };
}

/** Allowed screenshot types and size (also enforced by the Storage bucket). */
export const SCREENSHOT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024;
export const SCREENSHOTS_PER_TRADE = 6;

/** The Storage path of a screenshot: the owner's folder first (the bucket policy checks it). */
export function screenshotPath(ownerId: string, tradeId: number, n: number, type: string): string {
  const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
  return `${ownerId}/trade-${tradeId}-${n}.${ext}`;
}
