/**
 * Parser for the Nasdaq Trader trade-halts RSS feed
 * (https://www.nasdaqtrader.com/rss.aspx?feed=tradehalts).
 *
 * The feed is flat: each `<item>` holds `<ndaq:...>` fields. Times are US Eastern
 * (verified against the feed's own GMT timestamp when the fixture was recorded).
 * The feed lists the current day's halts and refreshes about once a minute.
 * Malformed items are returned in `skipped`, never dropped silently.
 */
import { etWallToUtc } from './calendar.js';

export interface Halt {
  symbol: string;
  name: string;
  market: string;
  reasonCode: string;
  /** Plain-language meaning for codes Marsad knows, otherwise null (the raw code is still shown). */
  reasonMeaning: string | null;
  /** True for codes that signal news pending or released, the ones the catalyst watch cares about. */
  newsRelated: boolean;
  haltedAt: Date;
  resumptionQuoteAt: Date | null;
  resumptionTradeAt: Date | null;
  pauseThresholdPrice: number | null;
  /** No trade resumption time has been published yet. */
  active: boolean;
}

export interface HaltsFeed {
  generatedAt: Date | null;
  items: Halt[];
  skipped: { reason: string; excerpt: string }[];
}

/** Meanings from Nasdaq's published halt reason codes. Codes not listed here return null. */
export const HALT_REASONS: Readonly<Record<string, { meaning: string; newsRelated: boolean }>> = {
  T1: { meaning: 'Halt: news pending', newsRelated: true },
  T2: { meaning: 'Halt: news released', newsRelated: true },
  T3: { meaning: 'Halt: news and resumption times announced', newsRelated: true },
  T5: { meaning: 'Single stock trading pause in effect', newsRelated: false },
  T6: { meaning: 'Halt: extraordinary market activity', newsRelated: false },
  T8: { meaning: 'Halt: exchange-traded fund', newsRelated: false },
  T12: { meaning: 'Halt: additional information requested by Nasdaq', newsRelated: false },
  H4: { meaning: 'Halt: non-compliance', newsRelated: false },
  H9: { meaning: 'Halt: not current in required filings', newsRelated: false },
  H10: { meaning: 'Halt: SEC trading suspension', newsRelated: false },
  H11: { meaning: 'Halt: regulatory concern', newsRelated: false },
  LUDP: { meaning: 'Volatility trading pause', newsRelated: false },
  LUDS: { meaning: 'Volatility trading pause: straddle condition', newsRelated: false },
};

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function field(item: string, tag: string): string | null {
  const re = new RegExp(`<ndaq:${tag}\\s*(?:/>|>([\\s\\S]*?)</ndaq:${tag}>)`);
  const m = re.exec(item);
  if (!m) return null;
  const v = decodeEntities((m[1] ?? '').trim());
  return v === '' ? null : v;
}

/** MM/DD/YYYY plus HH:MM:SS(.mmm), US Eastern, to a UTC instant. Null if either is missing. */
function easternInstant(dateStr: string | null, timeStr: string | null): Date | null {
  if (dateStr === null || timeStr === null) return null;
  const d = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dateStr);
  const t = /^(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(timeStr);
  if (!d || !t) return null;
  const ms = t[4] ? Number(t[4].padEnd(3, '0')) : 0;
  return etWallToUtc(`${d[3]}-${d[1]}-${d[2]}`, Number(t[1]), Number(t[2]), Number(t[3]), ms);
}

export function parseHaltsRss(xml: string): HaltsFeed {
  const generated = /<pubDate>([^<]+)<\/pubDate>/.exec(
    xml.slice(0, xml.indexOf('<item>') >>> 0 || xml.length),
  );
  const generatedAt = generated?.[1] ? new Date(generated[1]) : null;
  const items: Halt[] = [];
  const skipped: HaltsFeed['skipped'] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const item = m[1] ?? '';
    const symbol = field(item, 'IssueSymbol');
    const reasonCode = field(item, 'ReasonCode');
    const haltedAt = easternInstant(field(item, 'HaltDate'), field(item, 'HaltTime'));
    if (symbol === null || reasonCode === null || haltedAt === null) {
      skipped.push({
        reason: 'missing symbol, reason code or halt time',
        excerpt: item.trim().slice(0, 160),
      });
      continue;
    }
    const resumeDate = field(item, 'ResumptionDate');
    const threshold = field(item, 'PauseThresholdPrice');
    const known = HALT_REASONS[reasonCode];
    const resumptionTradeAt = easternInstant(resumeDate, field(item, 'ResumptionTradeTime'));
    items.push({
      symbol,
      name: field(item, 'IssueName') ?? '',
      market: field(item, 'Market') ?? '',
      reasonCode,
      reasonMeaning: known?.meaning ?? null,
      newsRelated: known?.newsRelated ?? false,
      haltedAt,
      resumptionQuoteAt: easternInstant(resumeDate, field(item, 'ResumptionQuoteTime')),
      resumptionTradeAt,
      pauseThresholdPrice:
        threshold !== null && Number.isFinite(Number(threshold)) ? Number(threshold) : null,
      active: resumptionTradeAt === null,
    });
  }
  return {
    generatedAt: generatedAt && !Number.isNaN(generatedAt.getTime()) ? generatedAt : null,
    items,
    skipped,
  };
}
