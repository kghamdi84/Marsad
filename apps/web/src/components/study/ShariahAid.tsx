import { useQuery } from '@tanstack/react-query';
import { etDate, toFixedHalfUp, type DailyBar } from '@marsad/core';
import { loadPreferences } from '../../lib/settings';
import { shariahAsOf } from '../../lib/shariah';
import { loadFacts } from '../../lib/studyPanels';
import { t } from '../../strings';
import { PanelShell } from './Panel';

/** The Shariah screening aid on its own tab: each ratio against its limit, with every caveat. Off until switched on in Status. */
export function ShariahAid({ cik, bars }: { cik: string; bars: readonly DailyBar[] }) {
  const x = t.study.shariah;
  const q = useQuery({ queryKey: ['facts', cik], queryFn: () => loadFacts(cik) });
  const prefs = useQuery({ queryKey: ['preferences'], queryFn: loadPreferences });
  const sh = prefs.data?.shariah;
  const screen = sh?.enabled && q.data ? shariahAsOf(q.data, bars, sh, etDate(new Date())) : null;
  return (
    <PanelShell id="shariah" title={x.title} state={q}>
      {!sh?.enabled ? (
        <p className="text-sm text-muted">{x.off}</p>
      ) : !screen ? (
        <p className="text-sm text-muted">{x.noBalance}</p>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-muted">{x.basis(screen.basis)}</p>
          {screen.ratios.map((r) => {
            const frac = r.value === null ? 0 : Math.min(1, r.value / r.max);
            return (
              <div key={r.name} className="flex flex-col gap-1">
                <p>
                  {x.ratio(
                    r.name,
                    r.value === null ? x.unknown : `${toFixedHalfUp(r.value * 100, 1)}%`,
                    `${toFixedHalfUp(r.max * 100, 1)}%`,
                    r.pass === null ? x.unknown : r.pass ? x.pass : x.fail,
                  )}
                </p>
                <div aria-hidden="true" className="relative h-2 rounded-full bg-faint/20">
                  <span
                    className={`absolute inset-y-0 start-0 rounded-full ${r.pass === false ? 'bg-down' : 'bg-up'}`}
                    style={{ width: `${toFixedHalfUp(frac * 100, 1)}%` }}
                  />
                </div>
              </div>
            );
          })}
          <p className="font-medium">{x.verdict[screen.verdict]}</p>
          <ul className="list-disc ps-5 text-xs text-muted">
            {screen.caveats.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
    </PanelShell>
  );
}
