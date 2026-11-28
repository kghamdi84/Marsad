/**
 * Grounded payloads for the AI jobs (ADR 0007, `ai-payload-1`): the facts (numbers computed by code from stored
 * filings) and the documents (filing text, untrusted) a filing summary or a thesis draft may use, each with a
 * citable id, plus the citation records stored with the output and a key that changes only when the sources do.
 * Pure: the job passes the stored rows.
 *
 * Every date and form number a model may write appears in a fact, so the verifier accepts it as written there.
 * Long filing text is cut to `DOC_CHAR_LIMIT` characters and the title says so, so a summary of an excerpt never
 * reads as a summary of the whole section.
 */
import { describeEightK } from '../filings.js';
import type { FinancialSummary, Metric } from '../fundamentals.js';
import { weeklyReviewFacts, type WeeklyInputs } from '../weekly-review.js';
import type { DocumentExcerpt, Fact, Payload } from './facts.js';

export const AI_PAYLOAD_VERSION = 'ai-payload-1';
/** The most characters of one filing section a payload carries. */
export const DOC_CHAR_LIMIT = 20_000;
/** 8-K filings older than this many days are left out of a summary. */
export const EIGHT_K_DAYS = 120;
export const MAX_EIGHT_KS = 5;

/** One citable source as stored with the output, so the page can link it. */
export interface CitationRef {
  id: string;
  kind: 'fact' | 'document';
  label: string;
  /** A link to the filing on sec.gov, when there is one. */
  url: string | null;
  source: string;
  /** The filing date (YYYY-MM-DD) the value or text became public. */
  asOf: string | null;
}

export interface StoredAnnualSection {
  periodEnd: string;
  filingDate: string;
  url: string;
  text: string;
}

export interface StoredQuarterlySection {
  accession: string;
  periodEnd: string | null;
  filingDate: string;
  url: string;
  text: string;
  noMaterialChanges: boolean;
}

export interface StoredEightK {
  accession: string;
  filingDate: string;
  items: readonly string[];
  url: string | null;
}

export interface FilingSources {
  ticker: string;
  cik: string;
  /** `summarizeFinancials` over the stored XBRL facts, as of today; null when none are stored. */
  financials: FinancialSummary | null;
  /** The newest 10-K risk factor section. */
  annual: StoredAnnualSection | null;
  /** The newest 10-Q risk factor section. */
  quarterly: StoredQuarterlySection | null;
  /** 8-K filings, any order; the builder keeps the newest within `EIGHT_K_DAYS` of `today`. */
  eightKs: readonly StoredEightK[];
  /** YYYY-MM-DD. */
  today: string;
}

export interface BuiltPayload {
  payload: Payload;
  /** Every id in the payload, with what to show for it. */
  refs: CitationRef[];
  /** What the text is built from, as stored in their tables. */
  sourceIds: string[];
  /** Changes only when a source or the payload version changes. */
  sourceKey: string;
  /** Plain notes on what was left out ("no 10-Q stored"), kept in the input snapshot. */
  notes: string[];
}

/** FNV-1a 64-bit as 16 hex digits, over a canonical string. Identifies content; not a security hash. */
export function contentKey(parts: readonly string[]): string {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (const ch of parts.join('\u0000')) {
    h ^= BigInt(ch.codePointAt(0) ?? 0);
    h = (h * prime) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0');
}

const DAY = 86_400_000;
const daysBetween = (a: string, b: string) =>
  (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY;

function excerpt(text: string): { text: string; cut: boolean } {
  return text.length <= DOC_CHAR_LIMIT
    ? { text, cut: false }
    : { text: text.slice(0, DOC_CHAR_LIMIT), cut: true };
}

const filingIndexUrl = (cik: string, accession: string) =>
  `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, '')}/${accession}-index.htm`;

/**
 * The payload for a filing summary or thesis draft. `promptKey` (for example `filing-summary@1`) is part of the
 * source key, so a new prompt version summarizes again.
 */
export function filingPayload(src: FilingSources, promptKey: string): BuiltPayload | null {
  const facts: Fact[] = [];
  const documents: DocumentExcerpt[] = [];
  const refs: CitationRef[] = [];
  const sourceIds: string[] = [];
  const notes: string[] = [];
  const addFact = (f: Omit<Fact, 'id'>, ref: Omit<CitationRef, 'id' | 'kind' | 'label'>) => {
    const id = `F${facts.length + 1}`;
    facts.push({ id, ...f });
    refs.push({ id, kind: 'fact', label: f.label, ...ref });
  };
  const addDoc = (
    d: Omit<DocumentExcerpt, 'id'>,
    ref: Omit<CitationRef, 'id' | 'kind' | 'label'>,
  ) => {
    const id = `D${documents.length + 1}`;
    documents.push({ id, ...d });
    refs.push({ id, kind: 'document', label: d.title, ...ref });
  };

  const q = src.financials?.quarters.at(-1) ?? null;
  if (q && q.revenue.value !== null && q.revenue.accession && q.revenue.filed) {
    const ref = {
      url: filingIndexUrl(src.cik, q.revenue.accession),
      source: `SEC XBRL company facts, accession ${q.revenue.accession}`,
      asOf: q.revenue.filed,
    };
    const period = `quarter ended ${q.end}`;
    addFact({ label: `Latest reported quarter end`, value: q.end, unit: 'date' }, ref);
    addFact({ label: `Filed with the SEC on`, value: q.revenue.filed, unit: 'date' }, ref);
    const metric = (label: string, m: Metric, unit: Fact['unit']) => {
      if (m.value === null) return notes.push(`${label}: not reported`);
      addFact(
        {
          label: `${label}, ${period}${m.derived ? ' (derived from year-to-date totals)' : ''}`,
          value: m.value,
          unit,
        },
        ref,
      );
    };
    metric('Revenue', q.revenue, 'usd');
    const pctFact = (label: string, v: number | null) =>
      v === null
        ? notes.push(`${label}: not available`)
        : addFact({ label: `${label}, ${period}`, value: v, unit: 'pct' }, ref);
    pctFact('Revenue change versus the same quarter a year earlier', q.revenueYoYPct);
    pctFact('Gross margin', q.grossMarginPct);
    pctFact('Operating margin', q.operatingMarginPct);
    metric('Net income', q.netIncome, 'usd');
    metric('Diluted earnings per share', q.epsDiluted, 'usd');
    sourceIds.push(`xbrl:${q.revenue.accession}:${q.end}`);
  } else notes.push('No quarterly figures stored');

  if (src.quarterly) {
    const x = src.quarterly;
    const ref = {
      url: x.url,
      source: `SEC 10-Q ${x.accession}, Part II Item 1A`,
      asOf: x.filingDate,
    };
    addFact({ label: '10-Q (quarterly report) filed on', value: x.filingDate, unit: 'date' }, ref);
    addFact(
      {
        label:
          '10-Q risk factors: the filing says there are no material changes since the annual report',
        value: x.noMaterialChanges ? 'yes' : 'no',
        unit: 'text',
      },
      ref,
    );
    const e = excerpt(x.text);
    addDoc(
      {
        title: `10-Q risk factors (Part II, Item 1A)${e.cut ? `, first ${DOC_CHAR_LIMIT} characters of ${x.text.length}` : ''}`,
        text: e.text,
        source: ref.source,
        publishedAt: x.filingDate,
      },
      ref,
    );
    sourceIds.push(`10q:${x.accession}`);
  } else notes.push('No 10-Q risk factor section stored');

  if (src.annual) {
    const x = src.annual;
    const ref = { url: x.url, source: 'SEC 10-K, Item 1A (risk factors)', asOf: x.filingDate };
    addFact({ label: '10-K (annual report) filed on', value: x.filingDate, unit: 'date' }, ref);
    addFact({ label: '10-K fiscal year ended', value: x.periodEnd, unit: 'date' }, ref);
    const e = excerpt(x.text);
    addDoc(
      {
        title: `10-K risk factors (Item 1A)${e.cut ? `, first ${DOC_CHAR_LIMIT} characters of ${x.text.length}` : ''}`,
        text: e.text,
        source: ref.source,
        publishedAt: x.filingDate,
      },
      ref,
    );
    sourceIds.push(`10k:${x.periodEnd}:${x.filingDate}`);
  } else notes.push('No 10-K risk factor section stored');

  const recent = [...src.eightKs]
    .filter(
      (f) =>
        daysBetween(f.filingDate, src.today) <= EIGHT_K_DAYS &&
        daysBetween(f.filingDate, src.today) >= 0,
    )
    .sort(
      (a, b) => b.filingDate.localeCompare(a.filingDate) || b.accession.localeCompare(a.accession),
    )
    .slice(0, MAX_EIGHT_KS);
  for (const f of recent) {
    const d = describeEightK(f.items);
    const ref = {
      url: f.url ?? filingIndexUrl(src.cik, f.accession),
      source: `SEC 8-K ${f.accession}`,
      asOf: f.filingDate,
    };
    const items = [
      ...d.items.map((i) => `item ${i.item} (${i.plain})`),
      ...d.unknown.map((n) => `item ${n} (not in Marsad's table)`),
    ];
    addFact(
      {
        label: `8-K (current report) filed on ${f.filingDate}: ${items.join(', ') || 'no items listed'}`,
        value: f.filingDate,
        unit: 'date',
      },
      ref,
    );
    sourceIds.push(`8k:${f.accession}`);
  }
  if (recent.length === 0) notes.push(`No 8-K in the last ${EIGHT_K_DAYS} days`);

  if (documents.length === 0 && facts.length === 0) return null;
  return {
    payload: { facts, documents },
    refs,
    sourceIds,
    sourceKey: contentKey([AI_PAYLOAD_VERSION, promptKey, src.ticker, ...sourceIds]),
    notes,
  };
}

/** The payload for the weekly review prose: the facts code computed for the template, no documents. */
export function weeklyPayload(x: WeeklyInputs, promptKey: string): BuiltPayload {
  const facts = weeklyReviewFacts(x);
  return {
    payload: { facts, documents: [] },
    refs: facts.map((f) => ({
      id: f.id,
      kind: 'fact' as const,
      label: f.label,
      url: null,
      source: f.source ?? 'Marsad journal',
      asOf: x.weekEnding,
    })),
    sourceIds: [`week:${x.weekEnding}`],
    sourceKey: contentKey([
      AI_PAYLOAD_VERSION,
      promptKey,
      x.weekEnding,
      JSON.stringify(facts.map((f) => [f.label, f.value])),
    ]),
    notes: [],
  };
}

/** The stored citation records for the ids a text uses (the template uses every fact). */
export function citationsFor(refs: readonly CitationRef[], ids: readonly string[]): CitationRef[] {
  const by = new Map(refs.map((r) => [r.id, r]));
  return ids.flatMap((id) => {
    const r = by.get(id);
    return r ? [r] : [];
  });
}
