import {
  BRIEF_VERSION,
  STARTING_TICKERS,
  buildCalendar,
  closeRecap,
  etDate,
  isTradingDay,
  preMarketBrief,
  runJob,
  sessionInfo,
  topicSummary,
  type Brief,
  type BriefInputs,
  type BriefKind,
  type EconEvent,
  type JobRunRecord,
  type TopicDay,
} from '@marsad/core';
import type { Store } from './store.js';

export interface BriefJobDeps {
  store: Store;
  now: () => Date;
  kind: BriefKind;
  /** Minutes before the regular open the pre-market brief is due (the schedule allows 30 to 90). */
  minutesBeforeOpen?: number;
  /** Sends the email; absent when no email channel is configured. Returns nothing or throws. */
  sendEmail?: (subject: string, text: string) => Promise<void>;
  tickers?: readonly string[];
}

const TOPIC_NAMES: Record<string, string> = {
  conflict: 'Conflict',
  sanctions: 'Sanctions',
  tariffs: 'Tariffs and trade',
  elections: 'Elections',
  centralBanks: 'Central banks',
  energy: 'Energy',
};

const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const DAY = 86_400_000;
const shift = (d: string, k: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + k * DAY).toISOString().slice(0, 10);

/** The plain-text email: title, sections, and what Marsad is and is not. */
export function briefText(b: Brief): string {
  const parts = [b.title, ''];
  for (const s of b.sections) parts.push(s.heading, ...s.lines.map((l) => `- ${l}`), '');
  parts.push(
    'Marsad watches and explains; you decide and place every order in Sahm.',
    `Built by templates from stored data (${b.version}); every number above is stored with this brief.`,
  );
  return parts.join('\n');
}

async function gather(store: Store, date: string, eventDate: string, tickers: readonly string[]) {
  const one = async (table: Parameters<Store['latest']>[0], cols: string, order: string) =>
    (await store.latest(table, cols, order, 1))[0];
  const regime = await one('regime_daily', 'date, label, recession_level', 'date');
  const fg = (
    await store.latest('fear_greed_daily', 'date, composite, label, available', 'date', 10)
  ).find((r) => r['composite'] !== null && r['composite'] !== undefined);
  const cap = await one('capitulation_daily', 'date, state', 'date');
  const fred = async (id: string) =>
    (await store.latest('fred_observations', `date, value|series_id=${id}`, 'date', 5)).find(
      (r) => r['value'] !== null && r['value'] !== undefined,
    );
  const vix = await fred('VIXCLS');
  const vix3m = await fred('VXVCLS');
  const breadth = await one('breadth_daily', 'date, above50, n50, above200, n200', 'date');
  const econ = await one('econ_calendar_snapshots', 'events', 'fetched_at');
  const earn = await one('earnings_estimate_snapshots', 'estimates', 'computed_at');
  const topics = (await store.latest(
    'news_topic_days',
    'date, version, total, counts, samples',
    'date',
    40,
  )) as unknown as TopicDay[];
  const sources = await store.latest('source_status', 'source, state', 'source', 100);
  const watchlist: BriefInputs['watchlist'] = [];
  for (const t of tickers) {
    const [a, b] = await store.latest('daily_bars', `date, close|ticker=${t}`, 'date', 2);
    const c1 = n(a?.['close']);
    const c0 = n(b?.['close']);
    if (a)
      watchlist.push({
        ticker: t,
        date: String(a['date']),
        change1d: c1 !== null && c0 ? c1 / c0 - 1 : null,
      });
  }
  const pct = (x: unknown, of: unknown) => {
    const a = n(x);
    const b = n(of);
    return a !== null && b ? (100 * a) / b : null;
  };
  let topic: BriefInputs['topic'] = null;
  const newest = topics[0]?.date;
  if (newest) {
    const best = topicSummary(topics, newest)
      .readings.filter((r) => r.ratio !== null && r.ratio >= 1.5 && r.last7 >= 5)
      .sort((x, y) => (y.ratio ?? 0) - (x.ratio ?? 0))[0];
    if (best)
      topic = {
        name: TOPIC_NAMES[best.topic] ?? best.topic,
        last7: best.last7,
        ratio: best.ratio ?? 0,
      };
  }
  const inputs: BriefInputs = {
    date,
    regime: regime
      ? {
          date: String(regime['date']),
          label: String(regime['label']),
          recession: String(regime['recession_level']),
        }
      : null,
    fearGreed: fg
      ? {
          date: String(fg['date']),
          composite: Number(fg['composite']),
          label: String(fg['label']),
          available: Number(fg['available']),
        }
      : null,
    capitulation: cap ? { date: String(cap['date']), state: String(cap['state']) } : null,
    vix: vix ? { date: String(vix['date']), value: Number(vix['value']) } : null,
    vix3m: vix3m ? { date: String(vix3m['date']), value: Number(vix3m['value']) } : null,
    breadth: breadth
      ? {
          date: String(breadth['date']),
          pctAbove50: pct(breadth['above50'], breadth['n50']),
          pctAbove200: pct(breadth['above200'], breadth['n200']),
        }
      : null,
    events: ((econ?.['events'] ?? []) as EconEvent[])
      .filter((e) => e.date === eventDate)
      .map((e) => ({ date: e.date, timeEt: e.timeEt, name: e.name, impact: e.impact })),
    earnings: ((earn?.['estimates'] ?? []) as { ticker: string; date: string }[])
      .filter((e) => e.date >= date && e.date <= shift(date, 7))
      .map((e) => ({ ticker: e.ticker, date: e.date })),
    watchlist,
    topic,
    staleSources: sources
      .filter((s) => s['state'] === 'stale' || s['state'] === 'unavailable')
      .map((s) => String(s['source'])),
  };
  return inputs;
}

/**
 * Builds and stores the pre-market brief or the close recap (ADR 0015) and emails it when an email channel is set.
 * The pre-market brief runs only inside its window before a regular open; the recap only on trading days. A brief
 * already emailed for the day is not emailed again.
 */
export async function runBriefJob(deps: BriefJobDeps): Promise<JobRunRecord> {
  const { store, now, kind } = deps;
  const run = await runJob(
    `brief-${kind}`,
    async () => {
      const at = now();
      const cal = buildCalendar(await store.getHolidays('NYSE'), 'NYSE');
      const today = etDate(at);
      const info = sessionInfo(at, cal);
      if (!info.tradingDay)
        return { rows: 0, details: { skipped: `${today} is not a trading day` } };
      if (kind === 'pre-market') {
        const target = deps.minutesBeforeOpen ?? 60;
        const open = info.regularOpen?.getTime() ?? 0;
        const before = (open - at.getTime()) / 60_000;
        if (before < target - 30 || before > target + 29)
          return {
            rows: 0,
            details: {
              skipped: `${Math.round(before)} minutes before the open, outside the window`,
            },
          };
      }
      let eventDate = today;
      if (kind === 'close-recap') {
        eventDate = shift(today, 1);
        for (let k = 0; k < 10 && !isTradingDay(eventDate, cal); k++)
          eventDate = shift(eventDate, 1);
      }
      const inputs = await gather(store, today, eventDate, deps.tickers ?? STARTING_TICKERS);
      const brief = kind === 'pre-market' ? preMarketBrief(inputs) : closeRecap(inputs);
      const prior = (
        await store.latest('briefs', `delivery|for_date=${today}`, 'created_at', 5)
      ).find((r) => (r['delivery'] as Record<string, string> | undefined)?.['kind'] === kind);
      const alreadySent =
        (prior?.['delivery'] as Record<string, string> | undefined)?.['email'] === 'sent';
      let email = 'not-configured';
      if (alreadySent) email = 'sent';
      else if (deps.sendEmail) {
        try {
          await deps.sendEmail(brief.title, briefText(brief));
          email = 'sent';
        } catch (e) {
          email = `failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200);
        }
      }
      // A rerun keeps the push state already recorded, so the dispatcher never pushes the same brief twice.
      const priorPush = (prior?.['delivery'] as Record<string, string> | undefined)?.['push'];
      const delivery = { kind, email, push: priorPush ?? 'pending', at: at.toISOString() };
      await store.saveBrief(brief, inputs, delivery);
      if (email.startsWith('failed')) throw new Error(`Brief stored, but the email ${email}`);
      return {
        rows: 1,
        details: { kind, date: today, version: BRIEF_VERSION, title: brief.title, email },
      };
    },
    () => now().getTime(),
  );
  await store.recordRun(run);
  return run;
}
