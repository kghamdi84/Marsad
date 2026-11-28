import { useMemo, useState } from 'react';
import {
  technicalAnalysis,
  technicalSummary,
  type DailyBar,
  type Gauge,
  type TaReading,
  type Timeframe,
} from '@marsad/core';
import { Segmented } from '../../Card';
import { Checklist, Num, Pill, type Tone } from '../../ui/kit';
import { dayMonthYear } from '../../../lib/dates';
import { R, SourceLine, Tile, money, plain, td, tdEnd, th, thEnd } from './shared';

const TF = ['daily', 'weekly', 'monthly'] as const;
const TONE: Record<TaReading, Tone> = { bullish: 'up', bearish: 'down', neutral: 'neutral' };

function ReadingPill({ r }: { r: TaReading | null }) {
  if (r === null) return <span className="text-ink3">{R.na}</span>;
  return <Pill tone={TONE[r]}>{R.tech.readings[r]}</Pill>;
}

function GaugeTile({ id, title, g }: { id: string; title: string; g: Gauge }) {
  const n = g.bullish + g.neutral + g.bearish;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1.5 rounded-[10px] border border-line bg-surface p-3">
      <h3 id={id} className="text-xs font-semibold text-ink2">
        {title}
      </h3>
      <span className="text-lg font-semibold">
        <ReadingPill r={g.reading} />
      </span>
      {n > 0 && (
        <div aria-hidden="true" className="flex h-2 overflow-hidden rounded-full bg-sub">
          <span className="bg-down" style={{ width: `${(g.bearish / n) * 100}%` }} />
          <span className="bg-ink3" style={{ width: `${(g.neutral / n) * 100}%` }} />
          <span className="bg-up" style={{ width: `${(g.bullish / n) * 100}%` }} />
        </div>
      )}
      <p className="text-xs text-ink2">
        <Num>{R.tech.counts(g.bearish, g.neutral, g.bullish)}</Num>
      </p>
    </section>
  );
}

export function TechnicalsView({ bars }: { bars: readonly DailyBar[] }) {
  const x = R.tech;
  const [tf, setTf] = useState<Timeframe>('daily');
  const a = useMemo(() => technicalAnalysis(bars, tf), [bars, tf]);
  const s = useMemo(() => technicalSummary(bars), [bars]);
  const asOf = a.asOf ? dayMonthYear(a.asOf) : R.na;
  const tfName = x.timeframes[tf] ?? tf;
  return (
    <>
      <Tile id="rs-tech-sum" title={x.summaryTitle} aside={<span className="text-sm font-semibold text-ink"><Num>{x.nOfM(s.positive, s.available)}</Num></span>}>
        <Checklist
          items={s.signals.map((g) => ({
            state: g.positive === null ? ('open' as const) : g.positive ? ('ok' as const) : ('no' as const),
            label: (
              <span>
                <span className="sr-only">{g.positive === null ? R.na : g.positive ? x.ruleTrue : x.ruleFalse}: </span>
                {x.rules[g.id]}
              </span>
            ),
            note: (
              <Num>
                {g.value === null
                  ? x.needs(g.needs)
                  : g.id === 'rsi-50'
                    ? x.rsiNote(plain(g.value, 1), s.rsiZone ? x.zones[s.rsiZone] : R.na)
                    : g.id === 'upper-half-52w'
                      ? x.rangeNote(plain(g.value, 0), s.range52w ? money(s.range52w.low) : R.na, s.range52w ? money(s.range52w.high) : R.na)
                      : g.id === 'macd-above-signal'
                        ? x.macdNote(plain(g.value, 3), plain(g.reference ?? 0, 3))
                        : x.vsNote(money(g.value), money(g.reference ?? 0))}
              </Num>
            ),
          }))}
        />
        <SourceLine>{x.summarySource(s.formulaVersion, s.indicatorVersions, s.asOf ? dayMonthYear(s.asOf) : R.na)}</SourceLine>
      </Tile>

      <Tile id="rs-tech" title={x.title}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented
            label={x.timeframe}
            options={TF.map((k) => ({ key: k, label: x.timeframes[k] ?? k }))}
            value={tf}
            onChange={setTf}
          />
          <span className="text-xs text-ink3">
            <Num>{x.asOf(tfName, asOf, a.bars)}</Num>
          </span>
        </div>
        <p className="text-xs text-ink3">{x.intraday}</p>
        <div className="grid grid-cols-1 gap-3 tablet:grid-cols-3">
          <GaugeTile id="rs-g-all" title={x.gauges.overall} g={a.gauges.overall} />
          <GaugeTile id="rs-g-ind" title={x.gauges.indicators} g={a.gauges.indicators} />
          <GaugeTile id="rs-g-ma" title={x.gauges.movingAverages} g={a.gauges.movingAverages} />
        </div>
        <div className="grid grid-cols-1 gap-4 wide:grid-cols-2">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <caption className="text-start text-xs font-semibold text-ink2">{x.maTitle}</caption>
              <thead>
                <tr>
                  <th className={th}>{x.cols.period}</th>
                  <th className={thEnd}>{x.cols.simple}</th>
                  <th className={thEnd}>{x.cols.exponential}</th>
                </tr>
              </thead>
              <tbody>
                {a.movingAverages.map((m) => (
                  <tr key={m.period}>
                    <th scope="row" className={`${td} font-medium text-ink2`}>
                      <Num>{x.ma(m.period)}</Num>
                    </th>
                    <td className={tdEnd}>
                      {m.simple === null ? R.na : <span className="inline-flex items-center gap-1.5">{money(m.simple)} <ReadingPill r={m.simpleReading} /></span>}
                    </td>
                    <td className={tdEnd}>
                      {m.exponential === null ? R.na : <span className="inline-flex items-center gap-1.5">{money(m.exponential)} <ReadingPill r={m.exponentialReading} /></span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <caption className="text-start text-xs font-semibold text-ink2">{x.indTitle}</caption>
              <thead>
                <tr>
                  <th className={th}>{x.cols.name}</th>
                  <th className={thEnd}>{x.cols.value}</th>
                  <th className={thEnd}>{x.cols.reading}</th>
                </tr>
              </thead>
              <tbody>
                {a.indicators.map((i) => (
                  <tr key={i.id}>
                    <th scope="row" className={`${td} font-medium text-ink2`}>
                      {x.indicators[i.id]}
                      <span className="block text-xs font-normal text-ink3">{x.indicatorRules[i.id]}</span>
                    </th>
                    <td className={tdEnd}>{i.value === null ? R.na : plain(i.value, 2)}</td>
                    <td className={tdEnd}>{i.id === 'atr' && i.value !== null ? <span className="text-xs text-ink3">{x.notCounted}</span> : <ReadingPill r={i.reading} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {a.pivots && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <caption className="text-start text-xs font-semibold text-ink2">
                <Num>{x.pivotsTitle(dayMonthYear(a.pivots.date))}</Num>
              </caption>
              <thead>
                <tr>
                  <th className={th}>{x.cols.method}</th>
                  {(['s3', 's2', 's1', 'p', 'r1', 'r2', 'r3'] as const).map((k) => (
                    <th key={k} className={thEnd}>
                      {k.toUpperCase()}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(['classic', 'fibonacci'] as const).map((m) => (
                  <tr key={m}>
                    <th scope="row" className={`${td} font-medium text-ink2`}>
                      {x.methods[m]}
                    </th>
                    {(['s3', 's2', 's1', 'p', 'r1', 'r2', 'r3'] as const).map((k) => (
                      <td key={k} className={tdEnd}>
                        {money(a.pivots![m][k])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-ink3">{x.method}</p>
        <SourceLine>{x.source(a.formulaVersion, asOf)}</SourceLine>
      </Tile>
    </>
  );
}
