import { useQuery } from '@tanstack/react-query';
import { etDate, toFixedHalfUp, type DailyBar } from '@marsad/core';
import { loadPreferences } from '../../lib/settings';
import { shariahAsOf } from '../../lib/shariah';
import { loadFacts } from '../../lib/studyPanels';
import { t } from '../../strings';
import { PanelShell } from './Panel';
import { BarRow, Num, Pill } from '../ui/kit';

/** The Shariah screening aid on its own tab: each ratio against its limit, with every caveat. Off until switched on in Status. */
export function ShariahAid({ cik, bars }: { cik: string; bars: readonly DailyBar[] }) {
  const x = t.study.shariah;
  const ui = t.study.ui;
  const q = useQuery({ queryKey: ['facts', cik], queryFn: () => loadFacts(cik) });
  const prefs = useQuery({ queryKey: ['preferences'], queryFn: loadPreferences });
  const sh = prefs.data?.shariah;
  const screen = sh?.enabled && q.data ? shariahAsOf(q.data, bars, sh, etDate(new Date())) : null;
  return (
    <PanelShell id="shariah" title={x.title} state={q}>
      {!sh?.enabled ? (
        <p className="text-sm text-ink3">{x.off}</p>
      ) : !screen ? (
        <p className="text-sm text-ink3">{x.noBalance}</p>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Pill
              tone={
                screen.verdict === 'passes-ratios'
                  ? 'up'
                  : screen.verdict === 'fails-ratios'
                    ? 'down'
                    : 'neutral'
              }
              className="font-semibold"
            >
              {x.verdict[screen.verdict]}
            </Pill>
            <span className="text-xs text-ink3">{x.basis(screen.basis)}</span>
          </div>
          <div className="flex flex-col gap-4">
            {screen.ratios.map((r) => (
              <BarRow
                key={r.name}
                label={ui.shariahRatioName[r.name] ?? r.name}
                value={
                  <Num>{r.value === null ? x.unknown : `${toFixedHalfUp(r.value * 100, 1)}%`}</Num>
                }
                width={r.value === null ? 0 : r.value * 100}
                limit={r.max * 100}
                barClass={r.pass === false ? 'bg-down' : 'bg-up'}
                note={x.ratio(
                  r.name,
                  r.value === null ? x.unknown : `${toFixedHalfUp(r.value * 100, 1)}%`,
                  `${toFixedHalfUp(r.max * 100, 1)}%`,
                  r.pass === null ? x.unknown : r.pass ? x.pass : x.fail,
                )}
              />
            ))}
          </div>
          <p className="text-xs text-ink3">{ui.shariahLimitTick}</p>
          <div className="rounded-[10px] bg-warn-soft p-3.5 text-[13px] leading-relaxed text-ink">
            <ul className="list-disc ps-5">
              {screen.caveats.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </PanelShell>
  );
}
