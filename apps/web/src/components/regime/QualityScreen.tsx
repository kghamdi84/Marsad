import { Link } from '@tanstack/react-router';
import { Info } from '../Info';
import { useQuery } from '@tanstack/react-query';
import { toFixedHalfUp } from '@marsad/core';
import { num, td, th, thNum } from '../study/Panel';
import { ErrorText } from '../ui';
import { loadQualityScreen } from '../../lib/quality';
import { t } from '../../strings';

const q = t.regime.quality;
const pct = (v: number) => `${toFixedHalfUp(v * 100, 1)}%`;

/** Quality at a discount (ADR 0035): shown always, marked active when the capitulation watch is on. */
export function QualityScreen({ capitulationOn }: { capitulationOn: boolean }) {
  const r = useQuery({ queryKey: ['quality-screen'], queryFn: loadQualityScreen });
  return (
    <section aria-labelledby="quality" className="flex flex-col gap-2">
      <h2 id="quality" className="font-semibold">
        {q.title}
      </h2>
      <Info>{q.intro}</Info>
      <p className="text-sm font-medium">{capitulationOn ? q.active : q.inactive}</p>
      {r.isError && <ErrorText message={r.error.message} />}
      {r.data &&
        (r.data.run === null ? (
          <p className="text-muted">{q.none}</p>
        ) : (
          <>
            <p className="text-sm">
              {q.summary(
                r.data.run.asOf,
                r.data.run.fiscalYear,
                r.data.run.priceDate ?? q.noPrice,
                r.data.run.universe,
                r.data.run.eligible,
                r.data.run.passed,
              )}
            </p>
            <p className="text-xs text-muted">
              {q.excluded(
                r.data.run.noCik,
                r.data.run.excluded['no-gross-profit'] ?? 0,
                r.data.run.excluded['not-profitable'] ?? 0,
                r.data.run.excluded['negative-equity'] ?? 0,
                (r.data.run.excluded['missing-data'] ?? 0) + (r.data.run.excluded['no-price'] ?? 0),
              )}
            </p>
            {r.data.run.insufficient ? (
              <p className="text-muted">{r.data.run.insufficient}</p>
            ) : r.data.rows.length === 0 ? (
              <p className="text-muted">{q.nonePassed}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className={th}>{q.colTicker}</th>
                      <th className={thNum}>{q.colQuality}</th>
                      <th className={thNum}>{q.colValue}</th>
                      <th className={thNum}>{q.colGp}</th>
                      <th className={thNum}>{q.colRoa}</th>
                      <th className={thNum}>{q.colEy}</th>
                      <th className={thNum}>{q.colBm}</th>
                      <th className={th}>{q.colNotes}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.data.rows.map((x) => (
                      <tr key={x.ticker}>
                        <td className={td}>
                          <Link
                            to="/study/$ticker"
                            params={{ ticker: x.ticker }}
                            className="inline-flex min-h-11 items-center underline"
                          >
                            {x.ticker}
                          </Link>{' '}
                          <span className="text-muted">{x.name}</span>
                        </td>
                        <td className={`${td} ${num}`}>{toFixedHalfUp(x.quality, 0)}</td>
                        <td className={`${td} ${num}`}>{toFixedHalfUp(x.value, 0)}</td>
                        <td className={`${td} ${num}`}>{pct(x.metrics.grossProfitability)}</td>
                        <td className={`${td} ${num}`}>{pct(x.metrics.roa)}</td>
                        <td className={`${td} ${num}`}>{pct(x.metrics.earningsYield)}</td>
                        <td className={`${td} ${num}`}>
                          {toFixedHalfUp(x.metrics.bookToMarket, 2)}
                        </td>
                        <td className={`${td} text-xs text-muted`}>{x.notes.join('; ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Info>{q.caveats}</Info>
          </>
        ))}
    </section>
  );
}
