import { etDate, type DividendEvent } from '@marsad/core';
import { cardClass } from '../Card';
import { t } from '../../strings';
import { panelTitle } from './Panel';

export interface DividendRowData extends DividendEvent {
  payDate: string | null;
  declarationDate: string | null;
}

/** The ex-dividend dates already loaded for the chart, listed in words. Newest first. */
export function Dividends({ rows }: { rows: readonly DividendRowData[] }) {
  const d = t.study.dividends;
  const today = etDate(new Date());
  return (
    <section aria-labelledby="dividends" className={`${cardClass} gap-3!`}>
      <h2 id="dividends" className={panelTitle}>
        {d.title}
      </h2>
      {rows.length === 0 ? (
        <p className="text-muted">{d.none}</p>
      ) : (
        <ul className="text-sm">
          {rows.slice(0, 6).map((r) => (
            <li key={r.exDividendDate}>
              {d.row(
                r.exDividendDate,
                `${r.currency === 'USD' ? '$' : `${r.currency} `}${r.cashAmount}`,
                r.payDate,
              )}
              {r.exDividendDate > today ? ` (${d.upcoming})` : ''}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
