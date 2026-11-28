import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { X } from 'lucide-react';
import {
  SCREEN_BOOLEAN_FIELDS,
  SCREEN_NUMERIC_FIELDS,
  SCREEN_PRESETS,
  SCREENER_VERSION,
  TICKER_SUMMARY_VERSION,
  filterProblem,
  screen,
  toFixedHalfUp,
  type ScreenField,
  type ScreenFilter,
  type ScreenMatch,
  type ScreenSort,
} from '@marsad/core';
import { Card, SkeletonCards } from '../components/Card';
import { Info } from '../components/Info';
import { TickerLink } from '../components/QuickLook';
import { PageTitle, Pill } from '../components/ui/kit';
import { Failure } from '../components/watch/shared';
import {
  decodeFilters,
  decodeSort,
  encodeFilters,
  encodeSort,
  loadScreenRows,
  valueOf,
} from '../lib/screener';
import { dayMonth } from '../lib/dates';
import { t } from '../strings';

const sc = t.screener;

/** How each figure is entered and shown: percent fields are typed in percent and stored as fractions. */
type Unit = 'signedPct' | 'pct' | 'usd' | 'ratio' | 'atr' | 'count' | 'dollars' | 'plain';
const UNIT: Record<string, Unit> = {
  close: 'usd',
  return_1w: 'signedPct',
  return_1m: 'signedPct',
  return_3m: 'signedPct',
  return_ytd: 'signedPct',
  return_1y: 'signedPct',
  rs_spy_63: 'signedPct',
  high_52w: 'usd',
  low_52w: 'usd',
  sma_20: 'usd',
  sma_50: 'usd',
  sma_200: 'usd',
  dividends_ttm: 'usd',
  analyst_target_mean: 'usd',
  range_position_52w: 'pct',
  atr_14_pct: 'pct',
  dividend_yield_ttm: 'pct',
  volume_ratio_20: 'ratio',
  stretch_50_atr: 'atr',
  avg_volume_20: 'count',
  avg_dollar_volume_20: 'dollars',
  analyst_count: 'plain',
  sessions_to_earnings: 'plain',
  rsi_14: 'plain',
  pe_ratio: 'plain',
  beta: 'plain',
};
const isPct = (field: string) => UNIT[field] === 'pct' || UNIT[field] === 'signedPct';
const label = (field: string) => sc.fields[field] ?? field;

const compact = (v: number) =>
  v >= 1e9
    ? `${toFixedHalfUp(v / 1e9, 1)}B`
    : v >= 1e6
      ? `${toFixedHalfUp(v / 1e6, 1)}M`
      : v >= 1e3
        ? `${toFixedHalfUp(v / 1e3, 0)}K`
        : toFixedHalfUp(v, 0);

/** A figure as text, with the sign and an arrow for changes (colour is never the only signal). */
function fmt(field: string, v: number | boolean | null): string {
  if (v === null) return sc.unavailable;
  if (typeof v === 'boolean') return v ? sc.yes : sc.no;
  switch (UNIT[field]) {
    case 'signedPct':
      return `${v > 0 ? '▲ +' : v < 0 ? '▼ −' : ''}${toFixedHalfUp(Math.abs(v) * 100, 1)}%`;
    case 'pct':
      return `${toFixedHalfUp(v * 100, 1)}%`;
    case 'usd':
      return toFixedHalfUp(v, 2);
    case 'ratio':
      return `${toFixedHalfUp(v, 1)}×`;
    case 'atr':
      return `${v > 0 ? '+' : v < 0 ? '−' : ''}${toFixedHalfUp(Math.abs(v), 1)} ATR`;
    case 'count':
      return compact(v);
    case 'dollars':
      return `$${compact(v)}`;
    default:
      return field === 'analyst_count' || field === 'sessions_to_earnings'
        ? String(Math.round(v))
        : toFixedHalfUp(v, field === 'beta' ? 2 : 1);
  }
}
const tone = (field: string, v: number | boolean | null) =>
  UNIT[field] === 'signedPct' && typeof v === 'number'
    ? v > 0
      ? 'text-up'
      : v < 0
        ? 'text-down'
        : ''
    : '';

/** A filter as the person edits it: values as typed (in percent for percent figures). */
interface Draft {
  field: ScreenField;
  op: string;
  a: string;
  b: string;
}

const show = (field: string, v: number) =>
  String(isPct(field) ? Number((v * 100).toPrecision(12)) : v);
function toDraft(f: ScreenFilter): Draft {
  const v = valueOf(f);
  if (v === undefined) return { field: f.field, op: f.op, a: '', b: '' };
  if (Array.isArray(v))
    return { field: f.field, op: 'between', a: show(f.field, v[0]), b: show(f.field, v[1]) };
  if (typeof v === 'boolean') return { field: f.field, op: 'eq', a: String(v), b: '' };
  return { field: f.field, op: f.op, a: show(f.field, v as number), b: '' };
}
const BOOL: ReadonlySet<string> = new Set(SCREEN_BOOLEAN_FIELDS);
const parse = (field: string, s: string) => {
  const n = s.trim() === '' ? Number.NaN : Number(s);
  return isPct(field) ? n / 100 : n;
};
function fromDraft(d: Draft): ScreenFilter {
  if (d.op === 'isNull' || d.op === 'notNull') return { field: d.field, op: d.op } as ScreenFilter;
  if (BOOL.has(d.field)) return { field: d.field, op: 'eq', value: d.a === 'true' } as ScreenFilter;
  if (d.op === 'between')
    return {
      field: d.field,
      op: 'between',
      value: [parse(d.field, d.a), parse(d.field, d.b)],
    } as ScreenFilter;
  return { field: d.field, op: d.op, value: parse(d.field, d.a) } as ScreenFilter;
}

const FIELDS: readonly ScreenField[] = [...SCREEN_BOOLEAN_FIELDS, ...SCREEN_NUMERIC_FIELDS];
const NUM_OPS = ['gte', 'gt', 'lte', 'lt', 'eq', 'between', 'notNull', 'isNull'] as const;
const BOOL_OPS = ['eq', 'notNull', 'isNull'] as const;
const input =
  'min-h-11 rounded-[7px] border border-line bg-elev px-2 text-[13px] font-semibold text-ink';

function FilterRow({
  d,
  onChange,
  onRemove,
}: {
  d: Draft;
  onChange: (d: Draft) => void;
  onRemove: () => void;
}) {
  const bool = BOOL.has(d.field);
  const ops = bool ? BOOL_OPS : NUM_OPS;
  const needsValue = d.op !== 'isNull' && d.op !== 'notNull';
  const problem = filterProblem(fromDraft(d));
  const name = label(d.field);
  const valueLabel = isPct(d.field) ? sc.inPercent(sc.value) : sc.value;
  return (
    <li className="flex flex-wrap items-end gap-2 border-b border-line pb-2 last:border-b-0">
      <label className="flex flex-col gap-1 text-xs text-ink3">
        {sc.field}
        <select
          value={d.field}
          onChange={(e) => {
            const field = e.target.value as ScreenField;
            const nowBool = BOOL.has(field);
            onChange({
              field,
              op: nowBool ? 'eq' : bool ? 'gte' : d.op,
              a: nowBool ? 'true' : bool ? '' : d.a,
              b: nowBool ? '' : d.b,
            });
          }}
          className={input}
        >
          {FIELDS.map((f) => (
            <option key={f} value={f}>
              {label(f)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink3">
        {sc.op}
        <select
          value={d.op}
          onChange={(e) => onChange({ ...d, op: e.target.value })}
          className={input}
        >
          {ops.map((o) => (
            <option key={o} value={o}>
              {bool && o === 'eq' ? sc.isTrue : sc.ops[o]}
            </option>
          ))}
        </select>
      </label>
      {needsValue && bool && (
        <label className="flex flex-col gap-1 text-xs text-ink3">
          {sc.value}
          <select
            value={d.a}
            onChange={(e) => onChange({ ...d, a: e.target.value })}
            className={input}
          >
            <option value="true">{sc.yes}</option>
            <option value="false">{sc.no}</option>
          </select>
        </label>
      )}
      {needsValue && !bool && (
        <label className="flex flex-col gap-1 text-xs text-ink3">
          {d.op === 'between' ? `${valueLabel}, ${sc.low}` : valueLabel}
          <input
            inputMode="decimal"
            value={d.a}
            onChange={(e) => onChange({ ...d, a: e.target.value })}
            className={`${input} w-28`}
          />
        </label>
      )}
      {needsValue && !bool && d.op === 'between' && (
        <label className="flex flex-col gap-1 text-xs text-ink3">
          {`${valueLabel}, ${sc.high}`}
          <input
            inputMode="decimal"
            value={d.b}
            onChange={(e) => onChange({ ...d, b: e.target.value })}
            className={`${input} w-28`}
          />
        </label>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={sc.removeFilter(name)}
        className="grid size-11 place-items-center rounded-[7px] border border-line text-ink2"
      >
        <X aria-hidden="true" size={16} />
      </button>
      {problem && <p className="basis-full text-xs text-warn">{problem}</p>}
    </li>
  );
}

function reasonText(r: ScreenMatch['reasons'][number]): string {
  const v = valueOf(r);
  const value =
    v === undefined
      ? ''
      : Array.isArray(v)
        ? sc.range(fmt(r.field, v[0]), fmt(r.field, v[1]))
        : fmt(r.field, v as number | boolean);
  const op = BOOL.has(r.field) && r.op === 'eq' ? sc.isTrue : (sc.ops[r.op] ?? r.op);
  return sc.reason(label(r.field), op, value, fmt(r.field, r.actual));
}

/**
 * Screener (ADR 0048 item 6): filters over the newest nightly summary rows with core `screener-1`. Every
 * condition must hold; a ticker missing a filtered figure is left out and counted by figure, never passed. The
 * filters and the sort live in the address (`?f=`, `?s=`), so a screen can be linked. Rows open the quick look.
 */
export function Screener() {
  const search: { f?: string; s?: string } = useSearch({ strict: false });
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['screen-rows'], queryFn: loadScreenRows });
  const decoded = useMemo(() => decodeFilters(search.f), [search.f]);
  const sort = decodeSort(search.s);
  const [drafts, setDrafts] = useState<Draft[]>(() => decoded.filters.map(toDraft));
  // A link or the back button changes the address: the drafts follow it, unless it is what they already say
  // (a draft being typed, such as "-", is not in the address yet and must not be overwritten).
  const [seen, setSeen] = useState(search.f);
  if (seen !== search.f) {
    setSeen(search.f);
    const valid = drafts.map(fromDraft).filter((f) => filterProblem(f) === null);
    if (encodeFilters(valid) !== (search.f ?? '')) setDrafts(decoded.filters.map(toDraft));
  }
  const write = (filters: readonly ScreenFilter[], s: ScreenSort | null) =>
    void navigate({
      to: '/screener',
      search: {
        ...(filters.length > 0 ? { f: encodeFilters(filters) } : {}),
        ...(s ? { s: encodeSort(s) } : {}),
      },
      replace: true,
      resetScroll: false,
    });
  const update = (next: Draft[]) => {
    setDrafts(next);
    write(
      next.map(fromDraft).filter((f) => filterProblem(f) === null),
      sort,
    );
  };
  const filters = drafts.map(fromDraft).filter((f) => filterProblem(f) === null);
  const rows = q.data ?? [];
  const result = screen(rows, filters, sort);
  const market = rows.filter((r) => r.coverage === 'market').length;
  const newest = rows.reduce((a, r) => (r.computed_at > a ? r.computed_at : a), '');
  const shownFields = [
    ...new Set([
      ...filters.map((f) => f.field),
      ...(sort && sort.field !== 'ticker' ? [sort.field] : []),
    ]),
  ].filter((f) => f !== 'close');
  return (
    <div className="flex flex-col gap-5">
      <PageTitle page="screener" aside={<Info>{sc.intro}</Info>} />
      <Card
        id="screener-filters-h"
        title={sc.filtersTitle}
        subtitle={market > 0 ? sc.scopeMarket(rows.length) : sc.scopeTracked}
      >
        <div role="group" aria-label={sc.presetsLabel} className="flex flex-wrap gap-2">
          {SCREEN_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setDrafts(p.filters.map(toDraft));
                write(p.filters, p.sort);
              }}
              className="min-h-11 rounded-[7px] border border-line bg-elev px-3 text-[13px] font-semibold text-ink2 hover:text-ink"
            >
              {sc.presets[p.id] ?? p.name}
            </button>
          ))}
        </div>
        {decoded.ignored.map((why) => (
          <p key={why} className="text-xs text-warn">
            {sc.ignored(why)}
          </p>
        ))}
        {drafts.length === 0 ? (
          <p className="text-sm text-ink3">{sc.noFilters}</p>
        ) : (
          <ul className="flex flex-col gap-2" aria-label={sc.filtersTitle}>
            {drafts.map((d, i) => (
              <FilterRow
                key={i}
                d={d}
                onChange={(n) => update(drafts.map((x, j) => (j === i ? n : x)))}
                onRemove={() => update(drafts.filter((_, j) => j !== i))}
              />
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <button
            type="button"
            onClick={() => update([...drafts, { field: 'return_1m', op: 'gte', a: '0', b: '' }])}
            className="min-h-11 rounded-[7px] border border-line-strong bg-surface px-3 text-[13px] font-semibold text-ink"
          >
            {sc.addFilter}
          </button>
          {drafts.length > 0 && (
            <button
              type="button"
              onClick={() => update([])}
              className="min-h-11 rounded-[7px] border border-line bg-elev px-3 text-[13px] font-semibold text-ink2"
            >
              {sc.clear}
            </button>
          )}
          <label className="flex flex-col gap-1 text-xs text-ink3">
            {sc.sortLabel}
            <select
              value={sort?.field ?? ''}
              onChange={(e) =>
                write(
                  filters,
                  e.target.value === ''
                    ? null
                    : {
                        field: e.target.value as ScreenSort['field'],
                        dir: sort?.dir ?? 'desc',
                      },
                )
              }
              className={input}
            >
              <option value="">{sc.noSort}</option>
              <option value="ticker">{sc.byTicker}</option>
              {SCREEN_NUMERIC_FIELDS.map((f) => (
                <option key={f} value={f}>
                  {label(f)}
                </option>
              ))}
            </select>
          </label>
          {sort && (
            <label className="flex flex-col gap-1 text-xs text-ink3">
              {sc.sortDir}
              <select
                value={sort.dir}
                onChange={(e) =>
                  write(filters, { field: sort.field, dir: e.target.value as 'asc' | 'desc' })
                }
                className={input}
              >
                <option value="desc">{sc.desc}</option>
                <option value="asc">{sc.asc}</option>
              </select>
            </label>
          )}
        </div>
        <p className="text-xs text-ink3">{sc.linkNote}</p>
      </Card>

      {q.isPending && <SkeletonCards heights={['12rem']} />}
      {q.isError && <Failure message={q.error.message} />}
      {q.isSuccess && rows.length === 0 && <p className="text-sm text-ink3">{sc.noRows}</p>}
      {q.isSuccess && rows.length > 0 && result.ok && (
        <Card
          id="screener-results-h"
          title={sc.resultsLabel}
          aside={<Pill>{sc.counts(result.matched, result.total)}</Pill>}
        >
          <p className="text-sm text-ink2">
            {[
              sc.counts(result.matched, result.total),
              sc.failed(result.failed),
              sc.missing(result.excludedMissing),
            ].join(' · ')}
          </p>
          {Object.keys(result.missingByField).length > 0 && (
            <ul
              className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink3"
              aria-label={sc.missingTitle}
            >
              {Object.entries(result.missingByField).map(([f, n]) => (
                <li key={f}>{sc.missingBy(label(f), n ?? 0)}</li>
              ))}
            </ul>
          )}
          {result.rows.length === 0 ? (
            <p className="text-sm text-ink3">{sc.none}</p>
          ) : (
            <div
              tabIndex={0}
              role="region"
              aria-label={sc.resultsLabel}
              className="overflow-x-auto focus:outline focus:outline-focus"
            >
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-xs text-ink3">
                    <th scope="col" className="px-2 py-2 text-start font-medium">
                      {sc.colTicker}
                    </th>
                    <th scope="col" className="px-2 py-2 text-end font-medium">
                      {sc.colClose}
                    </th>
                    {shownFields.map((f) => (
                      <th key={f} scope="col" className="px-2 py-2 text-end font-medium">
                        {label(f)}
                      </th>
                    ))}
                    <th scope="col" className="px-2 py-2 text-start font-medium">
                      {sc.colWhy}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((m) => (
                    <tr key={m.row.ticker} className="border-b border-line last:border-b-0">
                      <th scope="row" className="px-2 py-1.5 text-start font-semibold">
                        <TickerLink ticker={m.row.ticker} />
                      </th>
                      <td className="px-2 py-1.5 text-end whitespace-nowrap tabular-nums">
                        {fmt('close', m.row.close)}
                      </td>
                      {shownFields.map((f) => {
                        const v =
                          f === 'sessions_to_earnings'
                            ? m.sessionsToEarnings
                            : (m.row[f] as number | boolean | null);
                        return (
                          <td
                            key={f}
                            className={`px-2 py-1.5 text-end whitespace-nowrap tabular-nums ${tone(f, v)}`}
                          >
                            {fmt(f, v)}
                          </td>
                        );
                      })}
                      <td className="px-2 py-1.5 text-xs text-ink2">
                        {m.reasons.length === 0 ? '' : m.reasons.map(reasonText).join('; ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-ink3">
            {result.dates.length === 1 && newest
              ? sc.session(
                  dayMonth(result.dates[0] ?? ''),
                  new Date(newest).toISOString().slice(11, 16),
                )
              : sc.sessions(result.dates.map(dayMonth).join(', '))}
          </p>
          {filters.some((f) => f.field === 'sessions_to_earnings') && (
            <p className="text-xs text-ink3">{sc.sessionsNote}</p>
          )}
          <p className="text-xs text-ink3">
            {sc.formula(result.formulaVersion ?? SCREENER_VERSION, TICKER_SUMMARY_VERSION)}
          </p>
        </Card>
      )}
      {q.isSuccess && !result.ok && <Failure message={result.reason} />}
    </div>
  );
}
