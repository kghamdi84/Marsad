import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  MOVER_VIEWS,
  MOVERS_RULES,
  dualClock,
  etDate,
  toFixedHalfUp,
  type MarketMovers as UniverseMovers,
  type MoverRow,
  type MoverView,
  type MoversSession,
} from '@marsad/core';
import { Card, Segmented, SkeletonCards, useRemembered, useWide } from '../Card';
import { Info } from '../Info';
import { TickerLink } from '../QuickLook';
import { zoneName } from '../Clock';
import { Num, Pill } from '../ui/kit';
import { num } from '../study/Panel';
import { useDisplay } from '../../lib/display';
import { dayMonth, dayMonthYear, weekdayDayMonth } from '../../lib/dates';
import {
  catalystSince,
  loadMoverContext,
  loadMovers,
  loadMyMovers,
  loadMyTickers,
  type Catalyst,
  type MoverContext,
  type MoversData,
} from '../../lib/movers';
import { Change, Failure, v, w } from './shared';

const m = w.movers;

/**
 * Movers (movers-1, ADR 0049; ADR 0048): the whole market (owner only) with Gainers, Losers, Active, Unusual volume
 * and 52-week highs and lows, a minimum dollar-volume filter and an "On my list" filter, beside the Marsad universe
 * movers that members see too. Self-contained (its own data hook), so it can mount on Watch or a Markets page.
 * End-of-day data, never live; the latest stored headline is shown, never a cause.
 */
export function MarketMovers() {
  const q = useQuery({ queryKey: ['movers'], queryFn: loadMovers });
  const [pref, setPref] = useRemembered(
    'marsad.movers.scope',
    ['auto', 'market', 'universe'] as const,
    'auto',
  );
  if (q.isPending) return <SkeletonCards heights={['14rem']} />;
  if (q.isError) return <Failure message={q.error.message} />;
  const d = q.data;
  // Until a scope is chosen: the whole market when this account can read it, else the Marsad universe.
  const scope = pref === 'auto' ? (d.market ? 'market' : 'universe') : pref;
  const u = d.universe;
  return (
    <Card
      id="movers-h"
      title={scope === 'market' ? m.marketTitle : m.title}
      subtitle={scope === 'universe' && u ? m.asOf(u.date, u.n) : undefined}
    >
      <Segmented
        label={m.scopeLabel}
        options={(['market', 'universe'] as const).map((key) => ({ key, label: m.scope[key] }))}
        value={scope}
        onChange={setPref}
      />
      {scope === 'universe' ? <Universe m={u} /> : <WholeMarket data={d} />}
    </Card>
  );
}

/**
 * Watch's movers card (ADR 0048): the Marsad universe movers only, from the Watch read, which members see too.
 * The whole market, its filters and checks are on Markets.
 */
export function UniverseMoversCard({ movers }: { movers: UniverseMovers | null }) {
  return (
    <Card
      id="movers-h"
      title={m.title}
      subtitle={movers ? m.asOf(movers.date, movers.n) : undefined}
    >
      <Universe m={movers} />
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Marsad universe (watch-1): unchanged from the earlier Movers card.

type UniverseList = UniverseMovers['gainers'];

function UniverseRows({ xs, max }: { xs: UniverseList; max: number }) {
  return (
    <table className="w-full border-collapse text-sm">
      <tbody>
        {xs.map((x) => (
          <tr key={x.ticker}>
            <td className="w-14 py-1.5 pe-2 align-middle font-semibold text-ink">
              <TickerLink ticker={x.ticker} />
            </td>
            <td className="py-1.5 align-middle">
              <span aria-hidden="true" className="block h-2 rounded-full bg-sub">
                <span
                  className={`block h-full rounded-full ${x.change > 0 ? 'bg-up' : 'bg-down'}`}
                  style={{ width: `${toFixedHalfUp((Math.abs(x.change) / max) * 100, 1)}%` }}
                />
              </span>
              <span className="text-[11px] text-ink3">
                {toFixedHalfUp(x.close, 2)} {'·'}{' '}
                {m.dollarVolume(
                  Math.round(x.dollarVolume / 1e6).toLocaleString('en-US') + ' million',
                )}
              </span>
            </td>
            <td className={`w-20 py-1.5 ps-2 align-middle font-semibold ${num}`}>
              <Change v={x.change} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Universe({ m: u }: { m: UniverseMovers | null }) {
  if (!u) return <p className="text-sm text-ink3">{m.none}</p>;
  const max = Math.max(1e-9, ...[...u.gainers, ...u.losers].map((x) => Math.abs(x.change)));
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {[[m.gainers, u.gainers] as const, [m.losers, u.losers] as const].map(([title, xs]) => (
        <div key={title} className="flex flex-col gap-1">
          <h3 className="text-[13px] font-semibold text-ink3">{title}</h3>
          <UniverseRows xs={xs} max={max} />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Whole market (movers-1).

const FLOOR_KEYS = MOVERS_RULES.dollarVolumeFloors.map((_, i) => String(i));

/** USD amounts as words: 2,000,000 as "2 million", 1.234e9 as "1.23 billion". */
export function usdWords(n: number, digits = 1): string {
  if (n >= 1e9) return `${toFixedHalfUp(n / 1e9, 2).replace(/\.?0+$/, '')} billion`;
  if (n >= 1e6) return `${toFixedHalfUp(n / 1e6, digits).replace(/\.0+$/, '')} million`;
  return Math.round(n).toLocaleString('en-US');
}

const times = (x: number) => m.times(toFixedHalfUp(x, 1));

function WholeMarket({ data }: { data: MoversData }) {
  const [view, setView] = useRemembered('marsad.movers.view', MOVER_VIEWS, 'gainers');
  const [floorKey, setFloorKey] = useRemembered('marsad.movers.floor', FLOOR_KEYS, '0');
  const [mine, setMine] = useRemembered('marsad.movers.mine', ['off', 'on'] as const, 'off');
  const my = useQuery({
    queryKey: ['movers-mine'],
    queryFn: async () => {
      const t = await loadMyTickers();
      const all = [...new Set([...t.watchlist, ...t.holdings])].sort();
      return { ...(await loadMyMovers(all)), count: all.length };
    },
    enabled: mine === 'on',
  });
  const session: MoversSession | null =
    mine === 'on' ? (my.data?.session ?? null) : (data.market ?? null);
  const floorIdx = Number(floorKey);
  const result = session?.floors[floorIdx]?.views[view] ?? null;
  const tickers = useMemo(
    () =>
      result?.available
        ? [...new Set([...result.rows, ...result.checks].map((x) => x.ticker))]
        : [],
    [result],
  );
  const ctx = useQuery({
    queryKey: ['movers-context', session?.date, tickers],
    queryFn: () =>
      loadMoverContext(tickers, catalystSince(session?.previousDate ?? null, session?.date ?? '')),
    enabled: !!session && tickers.length > 0,
  });

  return (
    <div className="flex flex-col gap-3">
      {session && (
        <p className="text-xs text-muted">
          {m.header(
            `${weekdayDayMonth(session.date)} ${session.date.slice(0, 4)}`,
            mine === 'on' ? m.sourceMine : m.sourceMarket,
          )}
        </p>
      )}
      <Segmented
        label={m.viewLabel}
        options={MOVER_VIEWS.map((key) => ({ key, label: m.views[key] }))}
        value={view}
        onChange={setView}
      />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[13px] text-ink2">
          {m.floorLabel}
          <select
            value={floorKey}
            onChange={(e) => setFloorKey(e.target.value)}
            className="min-h-11 rounded-[7px] border border-line bg-elev px-2 text-[13px] font-semibold text-ink"
          >
            {MOVERS_RULES.dollarVolumeFloors.map((f, i) => (
              <option key={f} value={String(i)}>
                {m.floor(usdWords(f))}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          aria-pressed={mine === 'on'}
          onClick={() => setMine(mine === 'on' ? 'off' : 'on')}
          className={`min-h-11 rounded-[7px] border border-line px-3 text-[13px] font-semibold ${
            mine === 'on' ? 'bg-accent text-accent-ink' : 'bg-elev text-ink3 hover:text-ink'
          }`}
        >
          {m.mineLabel}
        </button>
      </div>
      <p className="text-xs text-ink3">{m.afterHours}</p>
      {mine === 'on' && my.data && (
        <p className="text-xs text-ink3">
          {m.mineNote(my.data.count)}
          {my.data.noBars.length > 0 && <> {m.noBars(my.data.noBars.join(', '))}</>}
        </p>
      )}
      {session && view === 'unusual' && (
        <p className="text-xs text-ink2">
          {m.unusualRule(
            times(session.rules.unusual.minRatio),
            usdWords(
              Math.max(
                session.rules.unusual.minDollarVolume,
                session.floors[floorIdx]?.minDollarVolume ?? 0,
              ),
            ),
            session.rules.unusual.sessions,
            session.rules.longVolumeSessions,
          )}
        </p>
      )}
      {session && (view === 'highs' || view === 'lows') && (
        <p className="text-xs text-ink2">{m.highLowRule(session.rules.highLowSessions)}</p>
      )}
      {mine === 'on' ? (
        my.isPending ? (
          <SkeletonCards heights={['8rem']} />
        ) : my.isError ? (
          <Failure message={my.error.message} />
        ) : null
      ) : !data.market ? (
        <p className="text-sm text-ink3">{data.marketVersion ? m.ownerOnly : m.notComputed}</p>
      ) : null}
      {session && result && <ViewBody view={view} result={result} ctx={ctx.data} />}
      {ctx.isError && <Failure message={ctx.error.message} />}
      {session && <About s={session} computedAt={mine === 'on' ? null : data.market?.computedAt} />}
    </div>
  );
}

function ViewBody({
  view,
  result,
  ctx,
}: {
  view: MoverView;
  result: NonNullable<MoversSession['floors'][number]['views'][MoverView]>;
  ctx: MoverContext | undefined;
}) {
  if (!result.available)
    return <p className="text-sm text-ink3">{m.unavailable(result.have, result.need)}</p>;
  return (
    <div className="flex flex-col gap-3">
      {result.rows.length === 0 ? (
        <p className="text-sm text-ink3">{m.empty}</p>
      ) : (
        <>
          <p className="text-xs text-ink3">{m.count(result.rows.length, result.qualified)}</p>
          <Rows view={view} rows={result.rows} ctx={ctx} />
        </>
      )}
      {result.checks.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[13px] font-semibold text-ink2">
            {m.checks(result.checksQualified)}
          </h3>
          <p className="text-xs text-ink3">{m.checksIntro}</p>
          <Rows view={view} rows={result.checks} ctx={ctx} />
        </div>
      )}
    </div>
  );
}

function CatalystText({ c }: { c: Catalyst | undefined }) {
  const { zone } = useDisplay();
  if (!c) return <span className="text-ink3">{m.noCatalyst}</span>;
  const when = c.dateOnly ? m.filedOn(dayMonth(c.at.slice(0, 10))) : stamp(c.at, zone);
  const title = c.url ? (
    <a
      href={c.url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-ink underline underline-offset-2"
    >
      {c.title}
    </a>
  ) : (
    c.title
  );
  return (
    <span className="text-ink2">
      {title}{' '}
      <span className="text-ink3">
        ({c.source}, <Num>{when}</Num>)
      </span>
    </span>
  );
}

function CheckNote({ x }: { x: MoverRow }) {
  if (!x.check) return null;
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-xs text-ink2">
      <Pill tone="warn">{m.checkPill}</Pill>
      {x.check.map((r) => m.reasons[r] ?? r).join('; ')}
      {x.split && <>. {m.split(x.split.from, x.split.to, dayMonthYear(x.split.date))}</>}
    </span>
  );
}

const ratioText = (x: MoverRow) =>
  x.volumeRatio === null
    ? v.noData
    : m.ratio(times(x.volumeRatio), x.volumeRatio50 === null ? null : times(x.volumeRatio50));

function Rows({
  view,
  rows,
  ctx,
}: {
  view: MoverView;
  rows: MoverRow[];
  ctx: MoverContext | undefined;
}) {
  const wide = useWide();
  const showRatio = view === 'unusual';
  const prior = view === 'highs' || view === 'lows' ? m.cols.prior[view] : null;
  if (!wide)
    return (
      <ul className="flex flex-col divide-y divide-line">
        {rows.map((x) => (
          <li key={x.ticker} className="flex flex-col gap-1 py-2 text-sm">
            <span className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <TickerLink ticker={x.ticker} />
                {ctx?.names[x.ticker] && (
                  <span className="truncate text-xs text-ink3">{ctx.names[x.ticker]}</span>
                )}
              </span>
              <span className="font-semibold whitespace-nowrap">
                <Change v={x.change} digits={2} />
              </span>
            </span>
            <span className="text-xs text-ink2">
              <Num>
                {m.cols.close} {toFixedHalfUp(x.close, 2)} {'·'} {m.volumeShort(usdWords(x.volume))}{' '}
                {'·'} {m.dollarVolume(usdWords(x.dollarVolume))}
              </Num>
              {showRatio && (
                <>
                  {' '}
                  {'·'} {m.cols.ratio}: <Num>{ratioText(x)}</Num>
                </>
              )}
              {prior && x.prior !== undefined && (
                <>
                  {' '}
                  {'·'} {prior}: <Num>{toFixedHalfUp(x.prior, 2)}</Num>
                </>
              )}
            </span>
            <CheckNote x={x} />
            <span className="text-xs">
              <span className="text-ink3">{m.cols.catalyst}: </span>
              <CatalystText c={ctx?.catalysts[x.ticker]} />
            </span>
          </li>
        ))}
      </ul>
    );
  const th = 'py-1.5 px-2 text-start text-xs font-semibold text-ink3 align-bottom';
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-line">
          <th scope="col" className={th}>
            {m.cols.ticker}
          </th>
          <th scope="col" className={`${th} text-end`}>
            {m.cols.change}
          </th>
          <th scope="col" className={`${th} text-end`}>
            {m.cols.close}
          </th>
          <th scope="col" className={`${th} text-end`}>
            {m.cols.volume}
          </th>
          {showRatio && (
            <th scope="col" className={`${th} text-end`}>
              {m.cols.ratio}
            </th>
          )}
          {prior && (
            <th scope="col" className={`${th} text-end`}>
              {prior}
            </th>
          )}
          <th scope="col" className={`${th} text-end`}>
            {m.cols.traded}
          </th>
          <th scope="col" className={th}>
            {m.cols.catalyst}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((x) => (
          <tr key={x.ticker} className="border-b border-line/60 align-top">
            <td className="px-2 py-1.5">
              <span className="flex flex-col">
                <TickerLink ticker={x.ticker} className="self-start" />
                {ctx?.names[x.ticker] && (
                  <span className="max-w-48 truncate text-xs text-ink3">{ctx.names[x.ticker]}</span>
                )}
              </span>
            </td>
            <td className={`px-2 py-1.5 font-semibold whitespace-nowrap ${num}`}>
              <Change v={x.change} digits={2} />
            </td>
            <td className={`px-2 py-1.5 ${num}`}>{toFixedHalfUp(x.close, 2)}</td>
            <td className={`px-2 py-1.5 whitespace-nowrap ${num}`}>{usdWords(x.volume)}</td>
            {showRatio && (
              <td className={`px-2 py-1.5 whitespace-nowrap ${num}`}>{ratioText(x)}</td>
            )}
            {prior && (
              <td className={`px-2 py-1.5 ${num}`}>
                {x.prior === undefined ? v.noData : toFixedHalfUp(x.prior, 2)}
              </td>
            )}
            <td className={`px-2 py-1.5 whitespace-nowrap ${num}`}>
              {m.floor(usdWords(x.dollarVolume))}
            </td>
            <td className="px-2 py-1.5 text-xs">
              <span className="flex flex-col gap-1">
                <CheckNote x={x} />
                <CatalystText c={ctx?.catalysts[x.ticker]} />
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** An instant as its ET date and time with the local time beside it (CLAUDE.md rule 7). */
function stamp(at: string, zone: string): string {
  const d = new Date(at);
  const c = dualClock(d, zone);
  return `${dayMonth(etDate(d))} ${c.et} ET (${c.local} ${zoneName(zone)})`;
}

function About({ s, computedAt }: { s: MoversSession; computedAt: string | null | undefined }) {
  const a = m.about;
  const { zone } = useDisplay();
  return (
    <Info>
      <p>{a.what}</p>
      <p>{a.eligible(s.eligibleAsOf)}</p>
      <p>
        {a.liquidity(
          toFixedHalfUp(s.rules.liquidity.minPrice, 2),
          usdWords(s.rules.liquidity.minDollarVolume),
        )}
      </p>
      <p>
        {m.unusualRule(
          times(s.rules.unusual.minRatio),
          usdWords(s.rules.unusual.minDollarVolume),
          s.rules.unusual.sessions,
          s.rules.longVolumeSessions,
        )}
      </p>
      <p>{m.highLowRule(s.rules.highLowSessions)}</p>
      <p>{a.guard}</p>
      <p>
        {a.counts({
          traded: s.traded,
          withChange: s.withChange,
          zero: s.badPrints.zeroPrice,
          noPrev: s.badPrints.noPreviousClose,
          price: s.belowLiquidity.price,
          dv: s.belowLiquidity.dollarVolume,
        })}
      </p>
      <p>{a.history(s.withVolumeHistory, s.withYearHistory)}</p>
      <p>{a.catalyst}</p>
      <p>{a.noAlerts}</p>
      <p>{a.formula(s.version, computedAt ? stamp(computedAt, zone) : dayMonthYear(s.date))}</p>
    </Info>
  );
}
