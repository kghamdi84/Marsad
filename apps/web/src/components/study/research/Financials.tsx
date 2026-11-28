import { useMemo, useState } from 'react';
import {
  OVERVIEW_LINES,
  etDate,
  financialsOverview,
  overviewRatios,
  piotroskiScore,
  toFixedHalfUp,
  type FinancialFact,
  type OverviewMode,
  type PiotroskiTest,
} from '@marsad/core';
import { Segmented } from '../../Card';
import { Checklist, Num } from '../../ui/kit';
import { formatUsd } from '../../../lib/study';
import { dayMonthYear } from '../../../lib/dates';
import { BarChart } from './charts';
import { R, SourceLine, Tile, pctText, plain, td, tdEnd, th, thEnd } from './shared';

const MODES = ['annual', 'ttm', 'quarterly'] as const;

const testValue = (x: PiotroskiTest): string => {
  const f = (v: number | null) =>
    v === null
      ? R.na
      : x.id === 'cfo-positive'
        ? formatUsd(v)
        : x.id === 'no-dilution'
          ? `${toFixedHalfUp(v / 1e6, 1)}M`
          : x.id === 'current-ratio-up' || x.id === 'asset-turnover-up'
            ? plain(v, 3)
            : pctText(v * 100, 2);
  return R.fin.testValues(f(x.current), f(x.prior));
};

function FScore({ facts }: { facts: readonly FinancialFact[] }) {
  const x = R.fin;
  const r = useMemo(() => piotroskiScore(facts, etDate(new Date())), [facts]);
  const groups = ['profitability', 'leverage', 'efficiency'] as const;
  return (
    <Tile
      id="rs-fscore"
      title={x.fTitle}
      aside={
        <span className="text-sm font-semibold text-ink">
          <Num>{r.score === null ? x.partial(r.passed, r.available) : x.score(r.score)}</Num>
        </span>
      }
    >
      {r.year === null ? (
        <p className="text-sm text-ink3">{x.noYear}</p>
      ) : (
        <p className="text-xs text-ink3">
          <Num>
            {x.years(
              dayMonthYear(r.year.end),
              r.priorYear ? dayMonthYear(r.priorYear.end) : R.na,
              r.filed ? dayMonthYear(r.filed) : R.na,
            )}
          </Num>
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 tablet:grid-cols-3">
        {groups.map((g) => (
          <section key={g} aria-labelledby={`rs-f-${g}`} className="flex flex-col gap-1.5">
            <h3 id={`rs-f-${g}`} className="text-xs font-semibold text-ink2">
              <Num>
                {x.group(x.groups[g], r.groups[g].passed, r.groups[g].available, r.groups[g].of)}
              </Num>
            </h3>
            <Checklist
              items={r.tests
                .filter((t) => t.group === g)
                .map((t) => ({
                  state:
                    t.passed === null
                      ? ('open' as const)
                      : t.passed
                        ? ('ok' as const)
                        : ('no' as const),
                  label: (
                    <span>
                      <span className="sr-only">
                        {t.passed === null ? x.na : t.passed ? x.passed : x.failed}:{' '}
                      </span>
                      {x.tests[t.id]}
                    </span>
                  ),
                  note: (
                    <Num>{t.passed === null ? x.missing(t.missing.join(', ')) : testValue(t)}</Num>
                  ),
                }))}
            />
          </section>
        ))}
      </div>
      <SourceLine>{x.fSource(r.formulaVersion)}</SourceLine>
    </Tile>
  );
}

function Overview({
  facts,
  onOpen,
}: {
  facts: readonly FinancialFact[];
  onOpen?: (() => void) | undefined;
}) {
  const x = R.fin;
  const [mode, setMode] = useState<OverviewMode>('annual');
  const today = etDate(new Date());
  const o = useMemo(() => financialsOverview(facts, today, mode), [facts, today, mode]);
  const annual = useMemo(() => financialsOverview(facts, today, 'annual'), [facts, today]);
  const cols = o.columns;
  return (
    <Tile id="rs-fin" title={x.oTitle}>
      <Segmented
        label={x.modes}
        options={MODES.map((m) => ({ key: m, label: x.modeNames[m] ?? m }))}
        value={mode}
        onChange={setMode}
      />
      {cols.length === 0 ? (
        <p className="text-sm text-ink3">{x.noColumns}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <caption className="sr-only">{x.oTitle}</caption>
            <thead>
              <tr>
                <th className={th}>{x.colLine}</th>
                {cols.map((c) => (
                  <th key={c.end} className={thEnd}>
                    <Num>
                      {mode === 'ttm' ? x.ttmHead(dayMonthYear(c.end)) : dayMonthYear(c.end)}
                    </Num>
                    {c.derived && <span className="block text-[11px]">{x.derivedMark}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {OVERVIEW_LINES.map((k) => (
                <tr key={k}>
                  <th scope="row" className={`${td} font-medium text-ink2`}>
                    {x.lines[k]}
                  </th>
                  {cols.map((c) => (
                    <td key={c.end} className={tdEnd}>
                      {c.values[k] === null ? (
                        <span className="text-ink3">{R.na}</span>
                      ) : (
                        formatUsd(c.values[k])
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {annual.columns.length > 0 && (
        <div className="grid grid-cols-1 gap-4 tablet:grid-cols-2">
          <BarChart
            label={x.chart1Aria(annual.columns.length)}
            groups={annual.columns.map((c) => ({
              label: c.end.slice(0, 4),
              values: [
                c.values.revenue === null ? null : c.values.revenue / 1e9,
                c.values.netIncome === null ? null : c.values.netIncome / 1e9,
              ],
            }))}
            series={[
              { name: x.revenueB, className: 'text-link' },
              { name: x.netIncomeB, className: 'text-up' },
            ]}
            line={{
              name: x.margin,
              values: annual.columns.map((c) => overviewRatios(c).profitMarginPct),
              className: 'text-warn',
            }}
            format={(v) => pctText(v, 1)}
          />
          <BarChart
            label={x.chart2Aria(annual.columns.length)}
            groups={annual.columns.map((c) => ({
              label: c.end.slice(0, 4),
              values: [
                c.values.totalAssets === null ? null : c.values.totalAssets / 1e9,
                c.values.totalLiabilities === null ? null : c.values.totalLiabilities / 1e9,
              ],
            }))}
            series={[
              { name: x.assetsB, className: 'text-link' },
              { name: x.liabilitiesB, className: 'text-down' },
            ]}
            line={{
              name: x.liabToAssets,
              values: annual.columns.map((c) => overviewRatios(c).liabilitiesToAssetsPct),
              className: 'text-ink',
            }}
            format={(v) => pctText(v, 0)}
          />
        </div>
      )}
      <p className="text-xs text-ink3">{x.oNote}</p>
      {onOpen && (
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex min-h-11 items-center self-start text-[13px] font-medium text-link underline-offset-4 hover:underline"
        >
          {x.openStatements}
        </button>
      )}
      <SourceLine>{x.oSource(o.formulaVersion, dayMonthYear(today))}</SourceLine>
    </Tile>
  );
}

export function FinancialsView({
  facts,
  factsError,
  hasCompany,
  onOpenStatements,
}: {
  facts: readonly FinancialFact[] | null;
  factsError: string | null;
  hasCompany: boolean;
  onOpenStatements?: (() => void) | undefined;
}) {
  if (!hasCompany) return <p className="text-sm text-ink3">{R.fin.noCompany}</p>;
  if (factsError)
    return (
      <p role="alert" className="text-sm text-crit">
        {factsError}
      </p>
    );
  if (!facts) return <p className="text-sm text-ink3">{R.loading}</p>;
  return (
    <>
      <FScore facts={facts} />
      <Overview facts={facts} onOpen={onOpenStatements} />
    </>
  );
}
