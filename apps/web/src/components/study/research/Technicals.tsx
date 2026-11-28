import { useMemo, useState } from 'react';
import {
  LEVELS_VERSION,
  priceLevels,
  technicalAnalysis,
  type DailyBar,
  type TaReading,
  type Timeframe,
} from '@marsad/core';
import { Segmented } from '../../Card';
import { Num, Pill, type Tone } from '../../ui/kit';
import { dayMonthYear } from '../../../lib/dates';
import { R, SourceLine, Tile, money, plain, signedPctText, td, tdEnd, th, thEnd } from './shared';

const TF = ['daily', 'weekly', 'monthly'] as const;
const TONE: Record<TaReading, Tone> = { bullish: 'up', bearish: 'down', neutral: 'neutral' };
const PIVOT_KEYS = ['s3', 's2', 's1', 'p', 'r1', 'r2', 'r3'] as const;

function ReadingPill({ r }: { r: TaReading | null }) {
  if (r === null) return <span className="text-ink3">{R.na}</span>;
  return <Pill tone={TONE[r]}>{R.tech.readings[r]}</Pill>;
}

/** Support and resistance (levels-1) from the stored daily bars, with what they are and are not. */
export function LevelsList({ bars }: { bars: readonly DailyBar[] }) {
  const x = R.chart;
  const lv = useMemo(() => priceLevels(bars), [bars]);
  return (
    <Tile id="rs-levels" title={x.levelsTitle}>
      {lv.levels.length === 0 ? (
        <p className="text-sm text-ink3">{x.noLevels}</p>
      ) : (
        <ul className="flex flex-col gap-0.5 text-sm text-ink2">
          {lv.levels.map((l) => (
            <li key={`${l.kind}-${l.price}`}>
              <Num>
                {x.levelLine(
                  l.kind === 'support' ? x.support : x.resistance,
                  l.touches,
                  money(l.price),
                  signedPctText(l.distancePct, 1),
                  dayMonthYear(l.from),
                  dayMonthYear(l.to),
                )}
              </Num>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-ink3">
        <Num>{x.levelsNote(lv.asOf ? dayMonthYear(lv.asOf) : R.na, LEVELS_VERSION)}</Num>
      </p>
    </Tile>
  );
}

/** technical-1: the n-of-m summary, levels and the indicator table, from one engine. No gauge, no patterns. */
export function TechnicalsView({ bars }: { bars: readonly DailyBar[] }) {
  const x = R.tech;
  const [tf, setTf] = useState<Timeframe>('daily');
  const a = useMemo(() => technicalAnalysis(bars, tf), [bars, tf]);
  const asOf = a.asOf ? dayMonthYear(a.asOf) : R.na;
  const tfName = x.timeframes[tf] ?? tf;
  const g = a.gauges;
  const counted = (k: keyof typeof g) => g[k].bullish + g[k].neutral + g[k].bearish;
  const pv = a.pivots;
  return (
    <>
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
        <p className="text-[15px] font-semibold text-ink" data-testid="tech-summary">
          <Num>{x.nOfM(g.overall.bullish, counted('overall'))}</Num>
        </p>
        <p className="text-sm text-ink2">
          <Num>
            {x.split(
              g.movingAverages.bullish,
              counted('movingAverages'),
              g.indicators.bullish,
              counted('indicators'),
              g.overall.bearish,
              g.overall.neutral,
            )}
          </Num>
        </p>
        <p className="text-xs text-ink3">{x.intraday}</p>
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
                      {m.simple === null ? (
                        R.na
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          {money(m.simple)} <ReadingPill r={m.simpleReading} />
                        </span>
                      )}
                    </td>
                    <td className={tdEnd}>
                      {m.exponential === null ? (
                        R.na
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          {money(m.exponential)} <ReadingPill r={m.exponentialReading} />
                        </span>
                      )}
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
                      <span className="block text-xs font-normal text-ink3">
                        {x.indicatorRules[i.id]}
                      </span>
                    </th>
                    <td className={tdEnd}>{i.value === null ? R.na : plain(i.value, 2)}</td>
                    <td className={tdEnd}>
                      {i.id === 'atr' && i.value !== null ? (
                        <span className="text-xs text-ink3">{x.notCounted}</span>
                      ) : (
                        <ReadingPill r={i.reading} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {pv && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <caption className="text-start text-xs font-semibold text-ink2">
                <Num>{x.pivotsTitle(dayMonthYear(pv.date))}</Num>
              </caption>
              <thead>
                <tr>
                  <th className={th}>{x.cols.method}</th>
                  {PIVOT_KEYS.map((k) => (
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
                    {PIVOT_KEYS.map((k) => (
                      <td key={k} className={tdEnd}>
                        {money(pv[m][k])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-ink3">{x.method}</p>
        <SourceLine>{x.source(a.formulaVersion, asOf, a.indicatorVersions)}</SourceLine>
      </Tile>
      <LevelsList bars={bars} />
    </>
  );
}
