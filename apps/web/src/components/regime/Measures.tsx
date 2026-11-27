import { seriesSnapshot, type Obs } from '@marsad/core';
import { Card, ScrollX } from '../Card';
import { num, td, th, thNum } from '../study/Panel';
import { fixed, signedFixed } from './format';
import { t } from '../../strings';

const r = t.regime;

export interface MeasureRow {
  label: string;
  obs: Obs[];
  digits?: number;
}

/** Latest value, 1-month change, 1-year percentile and the data date of each series. */
export function SnapshotTable({ label, rows }: { label: string; rows: MeasureRow[] }) {
  return (
    <ScrollX label={label}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className={th}>{r.colMeasure}</th>
            <th className={thNum}>{r.colLatest}</th>
            <th className={thNum}>{r.colChange}</th>
            <th className={thNum}>{r.colPercentile}</th>
            <th className={th}>{r.colAsOf}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label: name, obs, digits = 2 }) => {
            const s = seriesSnapshot(obs);
            return (
              <tr key={name}>
                <td className={td}>{name}</td>
                {s ? (
                  <>
                    <td className={`${td} ${num}`}>{fixed(s.value, digits)}</td>
                    <td className={`${td} ${num}`}>
                      {s.change === null ? '' : signedFixed(s.change, digits)}
                    </td>
                    <td className={`${td} ${num}`}>
                      {fixed(s.percentile, 0)}
                      {s.n < 252 && <span className="block text-xs text-ink3">{r.ofN(s.n)}</span>}
                    </td>
                    <td className={`${td} whitespace-nowrap`}>{s.date}</td>
                  </>
                ) : (
                  <td className={`${td} text-ink3`} colSpan={4}>
                    {r.noData}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollX>
  );
}

export function MeasuresCard({
  id,
  title,
  rows,
  notes,
}: {
  id: string;
  title: string;
  rows: MeasureRow[];
  notes: string[];
}) {
  return (
    <Card id={id} title={title}>
      <SnapshotTable label={r.ui.tables.measures} rows={rows} />
      {notes.map((n) => (
        <p key={n} className="text-xs text-ink3">
          {n}
        </p>
      ))}
    </Card>
  );
}
