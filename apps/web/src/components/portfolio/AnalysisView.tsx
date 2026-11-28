import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BETA_WINDOW,
  CORE_ETFS,
  MIN_BETA_OBS,
  CHECK_RULES,
  SECTOR_ETFS,
  betaBucket,
  checkNarrative,
  currentMix,
  distribution,
  marketCapBucket,
  mergeDividends,
  needsAttention,
  optionPositionView,
  peBucket,
  portfolioCheck,
  portfolioPe,
  resolveLimits,
  toFixedHalfUp,
  trailingDividends,
  type BookPosition,
  type Dimension,
} from '@marsad/core';
import { Card, Details, Segmented, useRemembered } from '../Card';
import { Info } from '../Info';
import { TickerLink } from '../QuickLook';
import { BarRow, Pill } from '../ui/kit';
import { loadEtfHoldings } from '../../lib/etf';
import { loadOptionPositions } from '../../lib/optionPositions';
import { tauricDividends } from '../../lib/portfolio';
import { MixChart } from './MixChart';
import {
  LimitsList,
  MiniTable,
  Source,
  ViewState,
  arrowPct,
  arrowUsd,
  bookOf,
  checkOf,
  groupLabel,
  lotsOf,
  p,
  pct1,
  price2,
  rowFigure,
  tone,
  usd,
  useLimits,
  usePortfolio,
  type Portfolio,
} from './shared';

const a = p.analysis;
const SUB = ['check', 'attention', 'groups', 'distribution'] as const;
type Sub = (typeof SUB)[number];

/** The check: the person's limits first, then Marsad's check rules, each beside its rule; then the paragraph. */
function Check({ x }: { x: Portfolio }) {
  const limits = useLimits();
  const book = bookOf(x);
  const oq = useQuery({ queryKey: ['option-positions'], queryFn: loadOptionPositions });
  if (!limits) return <p className="text-sm text-ink3">{p.loading}</p>;
  const { check: c } = checkOf(x, limits, currentMix(x.holdings, x.bars, BETA_WINDOW));
  const options = (oq.data?.positions ?? []).map((o) => ({
    o,
    v: optionPositionView(o, oq.data?.closes[o.underlying] ?? null, x.today),
  }));
  const top = book.positions.length ? [...book.positions].sort((m, n) => n.pct - m.pct) : [];
  return (
    <div className="flex flex-col gap-4">
      <LimitsList check={c} limits={limits} />
      <ul className="flex flex-col" aria-label={a.check.rowsLabel}>
        {c.rows
          .filter((r) => r.kind === 'rule')
          .map((r) => (
            <li
              key={r.id}
              className="flex flex-col gap-0.5 border-b border-line py-2 last:border-b-0"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="text-ink2">{a.check.name[r.id]}</span>
                <span className="flex items-center gap-2">
                  <span className="font-semibold text-ink tabular-nums">{rowFigure(r)}</span>
                  <Pill tone={r.state === 'above' ? 'down' : 'neutral'}>
                    {r.state === 'above'
                      ? a.check.pastRule
                      : r.state === 'within'
                        ? a.check.withinRule
                        : p.na}
                  </Pill>
                </span>
              </div>
              <p className="text-xs text-ink3">
                {a.check.rule(r.id, r.subject, r.limit === null ? p.na : rowFigure(r, r.limit))}
              </p>
            </li>
          ))}
      </ul>
      <p className="text-xs text-ink3">
        {a.check.betaNote(BETA_WINDOW, MIN_BETA_OBS, c.count - c.risk.betaAssumed.length, c.count)}
        {c.risk.betaAssumed.length > 0 && ` ${a.check.betaAssumed(c.risk.betaAssumed.join(', '))}`}
      </p>
      <div className="flex flex-col gap-2">
        <h3 className="text-[13px] font-semibold text-ink3">{a.check.sectors}</h3>
        {c.sectors.map((s) => (
          <BarRow
            key={s.sector}
            label={`${s.sector} (${s.tickers.join(', ')})`}
            value={pct1(s.weight)}
            width={s.weight * 100}
            limit={CHECK_RULES.sector * 100}
          />
        ))}
        <Source>{a.check.sectorSource(pct1(CHECK_RULES.sector))}</Source>
      </div>
      <div className="flex flex-col gap-1.5">
        <h3 className="text-[13px] font-semibold text-ink3">{a.check.performers}</h3>
        {top.length > 0 && (
          <MiniTable
            label={a.check.performers}
            head={[p.table.ticker, p.table.value, p.table.gainUsd, p.table.gainPct]}
            rows={top.map((pos) => [
              <TickerLink key="t" ticker={pos.ticker} />,
              usd(pos.value),
              <span key="u" className={tone(pos.usd)}>
                {arrowUsd(pos.usd)}
              </span>,
              <span key="p" className={tone(pos.pct)}>
                {arrowPct(pos.pct)}
              </span>,
            ])}
          />
        )}
        <p className="text-xs text-ink3">{a.check.belowCost(c.performance.belowCost, c.count)}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <h3 className="text-[13px] font-semibold text-ink3">{a.check.options}</h3>
        {oq.isError && <p className="text-sm text-down">{oq.error.message}</p>}
        {oq.data &&
          (options.length === 0 ? (
            <p className="text-sm text-ink3">{a.check.noOptions}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {options.map(({ o, v }) => (
                <li key={o.id} className="flex flex-wrap justify-between gap-2">
                  <span>
                    <TickerLink ticker={o.underlying} /> {o.label}
                  </span>
                  <span className="tabular-nums">
                    {a.check.optionLine(usd(v.netPremium), usd(Math.abs(v.maxLoss)), v.dte)}
                  </span>
                </li>
              ))}
            </ul>
          ))}
        <Source>{a.check.optionsSource}</Source>
      </div>
      <MixChart
        holdings={x.holdings}
        bars={x.bars}
        storageKey="marsad.portfolio.riskRange"
        fallback="d60"
      />
      <div className="flex flex-col gap-1 rounded-[10px] border border-line bg-elev p-3">
        <p className="text-sm leading-relaxed text-ink">{checkNarrative(c)}</p>
        <p className="text-xs text-ink3">{a.check.written}</p>
      </div>
      <Source>{a.check.source(c.version)}</Source>
    </div>
  );
}

/** Each fired rule: the fact, the rule and each named position's own exit condition, nothing else. */
function Attention({ x }: { x: Portfolio }) {
  const book = bookOf(x);
  const cards = needsAttention(book.positions);
  const exitOf = (tk: string) => {
    const lots = x.holdings.filter((h) => h.ticker === tk);
    const stops = lots.map((h) => h.stop).filter((s): s is number => s !== null);
    const hasAny = lots.some(
      (h) =>
        h.stop !== null || h.targets.length > 0 || h.trendBreak !== null || !!h.timeStopSessions,
    );
    if (!hasAny) return a.attention.noExit;
    return stops.length ? a.attention.stopAt(stops.map(price2).join(', ')) : a.attention.otherRules;
  };
  const fired = cards.filter((k) => k.met);
  const idle = cards.filter((k) => !k.met);
  const L = CHECK_RULES;
  return (
    <div className="flex flex-col gap-3">
      {fired.length === 0 && <p className="text-sm text-ink3">{a.attention.none}</p>}
      <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-3">
        {fired.map((k) => (
          <li
            key={k.id}
            className="flex flex-col gap-2 rounded-[10px] border border-line bg-elev p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-ink">{a.attention.title[k.id]}</span>
              <Pill tone={k.state === 'above' ? 'down' : k.state === 'positive' ? 'up' : 'neutral'}>
                {k.state === 'positive'
                  ? `▲ ${a.attention.positive}`
                  : k.state === 'above'
                    ? a.check.pastRule
                    : a.attention.note}
              </Pill>
            </div>
            <p className={`text-lg font-semibold tabular-nums ${tone(k.usd)}`}>{arrowUsd(k.usd)}</p>
            <p className="text-xs text-ink2">
              {a.attention.fact(
                k.id,
                k.value === null ? p.na : k.id === 'high-beta' ? String(k.value) : pct1(k.value),
                pct1(k.weight),
              )}
            </p>
            <p className="text-xs text-ink3">
              {a.attention.rule(
                k.id,
                k.id === 'high-beta' ? toFixedHalfUp(L.highBeta, 1) : pct1(k.limit),
              )}
            </p>
            <ul className="flex flex-col gap-1">
              {k.tickers.map((tk) => (
                <li key={tk} className="flex flex-wrap items-center gap-2 text-xs">
                  <TickerLink ticker={tk} />
                  <span className="text-ink2">{exitOf(tk)}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {idle.length > 0 && (
        <Details>
          <ul className="flex flex-col gap-1 text-xs text-ink3">
            {idle.map((k) => (
              <li key={k.id}>
                {a.attention.notMet(
                  a.attention.title[k.id],
                  a.attention.rule(
                    k.id,
                    k.id === 'high-beta' ? toFixedHalfUp(L.highBeta, 1) : pct1(k.limit),
                  ),
                )}
              </li>
            ))}
          </ul>
        </Details>
      )}
    </div>
  );
}

/** Positions grouped by the holding's own sector, else Tauric's sub-industry; each group opens to its table. */
function Groups({ x }: { x: Portfolio }) {
  const ps = bookOf(x).positions;
  const label = (pos: BookPosition) => {
    const h = x.holdings.find((y) => y.ticker === pos.ticker);
    return h ? groupLabel(h, x.data) : null;
  };
  const by = new Map<string, BookPosition[]>();
  for (const pos of ps) {
    const k = label(pos) ?? p.unclassified;
    by.set(k, [...(by.get(k) ?? []), pos]);
  }
  const groups = [...by.entries()]
    .map(([k, list]) => {
      const value = list.reduce((s, y) => s + y.value, 0);
      const cost = list.reduce((s, y) => s + y.cost, 0);
      return { k, list, value, usd: value - cost, pct: cost > 0 ? value / cost - 1 : 0 };
    })
    .sort((m, n) => n.value - m.value);
  return (
    <div className="flex flex-col gap-2">
      {groups.map((g) => (
        <details key={g.k} className="rounded-[10px] border border-line bg-elev">
          <summary className="flex min-h-11 cursor-pointer flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
            <span className="flex flex-col">
              <span className="font-semibold text-ink">{g.k}</span>
              <span className="text-xs text-ink3">{g.list.map((y) => y.ticker).join(', ')}</span>
            </span>
            <span className="flex gap-3 tabular-nums">
              <span className="text-ink">{usd(g.value)}</span>
              <span className={tone(g.usd)}>
                {arrowUsd(g.usd)} ({arrowPct(g.pct)})
              </span>
            </span>
          </summary>
          <div className="border-t border-line p-2">
            <MiniTable
              label={a.groups.tableAria(g.k)}
              head={[
                p.table.ticker,
                a.groups.name,
                p.table.value,
                p.table.gainUsd,
                p.table.gainPct,
              ]}
              align={['start', 'start', 'end', 'end', 'end']}
              rows={g.list.map((y) => [
                <TickerLink key="t" ticker={y.ticker} />,
                x.data?.names[y.ticker] ?? p.na,
                usd(y.value),
                <span key="u" className={tone(y.usd)}>
                  {arrowUsd(y.usd)}
                </span>,
                <span key="p" className={tone(y.pct)}>
                  {arrowPct(y.pct)}
                </span>,
              ])}
            />
          </div>
        </details>
      ))}
      <Source>{a.groups.source}</Source>
    </div>
  );
}

const DIMS: readonly Dimension[] = ['sector', 'marketCap', 'dividend', 'beta', 'pe'];
const knownEtfs = new Set<string>([...CORE_ETFS, ...SECTOR_ETFS.map((s) => s.ticker)]);

/** Asset split, a switchable distribution with the selected slice's holdings, portfolio beta and P/E. */
function Distribution({ x }: { x: Portfolio }) {
  const [dim, setDim] = useRemembered<Dimension>('marsad.portfolio.dimension', DIMS, 'sector');
  const [slice, setSlice] = useState<string | null>(null);
  const eq = useQuery({ queryKey: ['etf-holdings'], queryFn: loadEtfHoldings });
  const oq = useQuery({ queryKey: ['option-positions'], queryFn: loadOptionPositions });
  const book = bookOf(x);
  const ps = book.positions;
  const etfs = new Set([...knownEtfs, ...(eq.data?.reports ?? []).map((r) => r.etf)]);
  const etfValue = ps.filter((y) => etfs.has(y.ticker)).reduce((s, y) => s + y.value, 0);
  const optionPremium = (oq.data?.positions ?? []).reduce(
    (s, o) => s + optionPositionView(o, oq.data?.closes[o.underlying] ?? null, x.today).netPremium,
    0,
  );
  const research = x.data?.research ?? {};
  const payouts = mergeDividends(x.data?.dividends ?? [], tauricDividends(research));
  const keyOf = (y: BookPosition): string => {
    const prof = research[y.ticker]?.profile ?? null;
    if (dim === 'sector') return y.sector ?? 'Unclassified';
    if (dim === 'marketCap') return a.dist.bucket[marketCapBucket(prof?.market_cap ?? null)] ?? '';
    if (dim === 'beta') return a.dist.bucket[betaBucket(y.beta)] ?? '';
    if (dim === 'pe') return a.dist.bucket[peBucket(prof?.pe_ratio ?? null)] ?? '';
    const t = trailingDividends(
      payouts.filter((d) => d.ticker === y.ticker),
      y.priceDate ?? x.today,
    );
    return t.perShare > 0 ? a.dist.payer : a.dist.nonPayer;
  };
  const rows = distribution(ps.map((y) => ({ ticker: y.ticker, value: y.value, key: keyOf(y) })));
  const chosen = rows.find((r) => r.key === slice) ?? rows[0] ?? null;
  const pe = portfolioPe(
    ps.map((y) => ({
      ticker: y.ticker,
      value: y.value,
      pe: research[y.ticker]?.profile?.pe_ratio ?? null,
    })),
  );
  const betas = ps
    .filter((y): y is BookPosition & { beta: number } => y.beta !== null)
    .sort((m, n) => n.beta - m.beta);
  // Only the value-weighted beta is read here; the limits do not matter to it.
  const c = portfolioCheck({
    lots: lotsOf(x.holdings, x.bars, x.data),
    mix: null,
    cash: null,
    limits: resolveLimits({ role: 'member' }).limits,
  });
  const total = book.value;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h3 className="text-[13px] font-semibold text-ink3">{a.dist.assets}</h3>
        <BarRow
          label={a.dist.stocks}
          value={usd(total - etfValue)}
          width={total > 0 ? ((total - etfValue) / total) * 100 : 0}
        />
        <BarRow
          label={a.dist.etfs}
          value={usd(etfValue)}
          width={total > 0 ? (etfValue / total) * 100 : 0}
        />
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="text-ink2">{a.dist.options}</span>
          <span className="font-semibold text-ink tabular-nums">
            {oq.data ? a.dist.optionsValue(usd(optionPremium), oq.data.positions.length) : p.na}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="text-ink2">{a.dist.cash}</span>
          <span className="font-semibold text-ink3">{p.notTracked}</span>
        </div>
        <Source>{a.dist.assetsSource}</Source>
      </div>
      <div className="flex flex-col gap-2">
        <Segmented
          label={a.dist.dimLabel}
          options={DIMS.map((k) => ({ key: k, label: a.dist.dims[k] }))}
          value={dim}
          onChange={(k) => {
            setDim(k);
            setSlice(null);
          }}
        />
        <ul className="flex flex-col gap-1.5" aria-label={a.dist.listAria(a.dist.dims[dim])}>
          {rows.map((r) => (
            <li key={r.key}>
              <button
                type="button"
                aria-pressed={chosen?.key === r.key}
                onClick={() => setSlice(r.key)}
                className={`flex min-h-11 w-full flex-col gap-1 rounded-lg px-2 py-1.5 text-start ${chosen?.key === r.key ? 'bg-sub' : ''}`}
              >
                <BarRow
                  label={a.dist.sliceLabel(r.key, r.count)}
                  value={pct1(r.weight)}
                  width={r.weight * 100}
                />
              </button>
            </li>
          ))}
        </ul>
        {chosen && (
          <p className="text-xs text-ink2">
            {a.dist.major(chosen.key, chosen.tickers.slice(0, 5).join(', '))}
          </p>
        )}
        <Source>{a.dist.dimSource[dim]}</Source>
      </div>
      <div className="flex flex-col gap-1.5">
        <h3 className="text-[13px] font-semibold text-ink3">{a.dist.betaTitle}</h3>
        <p className="text-lg font-semibold text-ink tabular-nums">
          {c.risk.beta === null ? p.na : toFixedHalfUp(c.risk.beta, 2)}
        </p>
        <p className="text-xs text-ink3">
          {a.check.betaNote(BETA_WINDOW, MIN_BETA_OBS, betas.length, ps.length)}
        </p>
        <ul className="flex flex-col gap-1.5 text-sm">
          {betas.slice(0, 5).map((y) => (
            <li key={y.ticker} className="flex justify-between gap-2">
              <TickerLink ticker={y.ticker} />
              <span className="tabular-nums">{toFixedHalfUp(y.beta, 2)}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-1.5">
        <h3 className="text-[13px] font-semibold text-ink3">{a.dist.peTitle}</h3>
        <p className="text-lg font-semibold text-ink tabular-nums">
          {pe.pe === null ? p.na : toFixedHalfUp(pe.pe, 1)}
        </p>
        <p className="text-xs text-ink3">
          {a.dist.peFormula(pe.included.length, ps.length, pct1(pe.coverage))}
        </p>
        <ul className="flex flex-col gap-1.5 text-sm">
          {pe.included.slice(0, 5).map((y) => (
            <li key={y.ticker} className="flex justify-between gap-2">
              <TickerLink ticker={y.ticker} />
              <span className="tabular-nums">{toFixedHalfUp(y.pe, 1)}</span>
            </li>
          ))}
        </ul>
        {pe.notMeaningful.length > 0 && (
          <p className="text-xs text-ink3">{a.dist.peNotMeaningful(pe.notMeaningful.join(', '))}</p>
        )}
      </div>
      <ul className="flex flex-col gap-1 text-xs text-ink3">
        {a.dist.unavailable.map((u) => (
          <li key={u}>{u}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Analysis: the portfolio check (`portfolio-check-1`), the "Needs attention" rules, groups and the distribution.
 * Every measure sits beside the rule it is compared with; there is no single score.
 */
export function AnalysisView() {
  const x = usePortfolio();
  const [sub, setSub] = useRemembered<Sub>('marsad.portfolio.analysis', SUB, 'check');
  return (
    <Card id="portfolio-analysis-h" title={a.title} aside={<Info>{a.info}</Info>}>
      <ViewState x={x}>
        <Segmented
          label={a.subLabel}
          options={SUB.map((k) => ({ key: k, label: a.sub[k] }))}
          value={sub}
          onChange={setSub}
        />
        {sub === 'check' && <Check x={x} />}
        {sub === 'attention' && <Attention x={x} />}
        {sub === 'groups' && <Groups x={x} />}
        {sub === 'distribution' && <Distribution x={x} />}
      </ViewState>
    </Card>
  );
}
