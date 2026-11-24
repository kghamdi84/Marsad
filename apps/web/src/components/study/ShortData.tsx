import { useQuery } from '@tanstack/react-query';
import { formatFactValue } from '@marsad/core';
import { loadShortData } from '../../lib/studyPanels';
import { t } from '../../strings';
import { PanelShell, num, td, th, thNum } from './Panel';

const count = (v: number) =>
  formatFactValue({ id: '', label: '', value: Math.round(v), unit: 'shares' });

export function ShortData({ ticker }: { ticker: string }) {
  const q = useQuery({ queryKey: ['short', ticker], queryFn: () => loadShortData(ticker) });
  const s = t.study.shortData;
  return (
    <PanelShell id="short" title={s.title} state={q}>
      {q.data && q.data.interest.length === 0 && q.data.volume.length === 0 ? (
        <p className="text-muted">{s.none}</p>
      ) : (
        q.data && (
          <>
            <p className="text-sm text-muted">{s.interestDef}</p>
            <p className="text-sm text-muted">{s.lag}</p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className={th}>{s.colSettle}</th>
                    <th className={thNum}>{s.colShort}</th>
                    <th className={thNum}>{s.colAdv}</th>
                    <th className={thNum}>{s.colDtc}</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.interest.map((r) => (
                    <tr key={r.date}>
                      <td className={td}>{r.date}</td>
                      <td className={`${td} ${num}`}>{count(r.shortInterest)}</td>
                      <td className={`${td} ${num}`}>
                        {r.avgDailyVolume === null ? '' : count(r.avgDailyVolume)}
                      </td>
                      <td className={`${td} ${num}`}>
                        {r.daysToCover === null ? '' : r.daysToCover.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-sm text-muted">{s.volumeDef}</p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className={th}>{s.colDay}</th>
                    <th className={thNum}>{s.colTotal}</th>
                    <th className={thNum}>{s.colShortVol}</th>
                    <th className={thNum}>{s.colRatio}</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.volume.map((r) => (
                    <tr key={r.date}>
                      <td className={td}>{r.date}</td>
                      <td className={`${td} ${num}`}>{count(r.totalVolume)}</td>
                      <td className={`${td} ${num}`}>{count(r.shortVolume)}</td>
                      <td className={`${td} ${num}`}>
                        {r.ratio === null ? '' : `${r.ratio.toFixed(1)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      )}
    </PanelShell>
  );
}
