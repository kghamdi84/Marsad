/**
 * The scorecard (design `pAlerts`, "Scorecard"): each recent alert's result after 1, 5 and 20 sessions in its own
 * direction against SPY, before costs, with "Insufficient history (n of 30)" in the header until a rule has 30
 * scored cases (rule 10). Rates, the rule table and the calibration appear only from 30 cases up.
 */
import { useQuery } from '@tanstack/react-query';
import { calibration, etDate, summarize, toFixedHalfUp } from '@marsad/core';
import { ScrollX, cardClass } from '../Card';
import { Num, Pill, signedPct } from '../ui/kit';
import { loadScorecard } from '../../lib/alerts';
import { dayMonth } from '../../lib/dates';
import { t } from '../../strings';

const s = t.alerts.scorecard;
const HORIZONS = ['1d', '5d', '20d'] as const;
const share = (v: number) => `${toFixedHalfUp(v * 100, 1)}%`;
const pctSigned = (v: number | null) => (v === null ? '–' : signedPct(v * 100, 2));
const th = 'pb-1.5 text-xs font-normal text-ink3';
const td = 'border-t border-line py-2';

export function Scorecard() {
  const q = useQuery({ queryKey: ['scorecard'], queryFn: loadScorecard });
  if (q.isPending) return null;
  if (q.isError)
    return (
      <p role="alert" className="text-down">
        {q.error.message}
      </p>
    );
  const rows = summarize(q.data.alerts, q.data.outcomes);
  const pending = q.data.outcomes.filter((o) => o.status === 'pending').length;
  const cal = calibration(q.data.alerts, q.data.outcomes, '5d');
  const perAlert = [...q.data.alerts]
    .sort((x, y) => y.createdAt.localeCompare(x.createdAt))
    .slice(0, 8)
    .map((al) => ({
      id: al.id,
      label: s.alertLabel(
        `${al.ticker ?? ''} ${al.ruleId}`.trim(),
        dayMonth(etDate(new Date(al.createdAt))),
      ),
    }));
  const enough = rows.filter((r) => !r.insufficient);
  // Rules with fewer than 30 scored cases: one line each with its count, never a percentage.
  const thin = [
    ...new Map(
      rows
        .filter(
          (r) =>
            r.insufficient && !enough.some((e) => e.ruleId === r.ruleId && e.status === r.status),
        )
        .sort((x, y) => x.n - y.n)
        .map((r) => [`${r.ruleId}-${r.status}`, r]),
    ).values(),
  ];
  const most = rows.reduce((m, r) => Math.max(m, r.n), 0);
  return (
    <section aria-labelledby="scorecard" className={cardClass}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="scorecard" className="text-base font-semibold text-ink">
          {s.title}
        </h2>
        {enough.length === 0 && <Pill>{s.insufficientRow(most)}</Pill>}
      </div>
      <p className="-mt-1 text-xs text-ink3">{s.sub}</p>
      <p className="sr-only">{s.intro}</p>
      {perAlert.length === 0 && <p className="text-sm text-ink3">{s.none}</p>}
      {perAlert.length > 0 && (
        <ScrollX label={s.perAlertLabel}>
          <table className="w-full border-collapse text-[13px] tabular-nums">
            <thead>
              <tr>
                <th scope="col" className={`${th} text-start`}>
                  {s.colAlert}
                </th>
                {HORIZONS.map((h) => (
                  <th key={h} scope="col" className={`${th} ps-2.5 text-end whitespace-nowrap`}>
                    {s.sessions(h.replace('d', ''))}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {perAlert.map((al) => (
                <tr key={al.id}>
                  <th scope="row" className={`${td} pe-2.5 text-start font-normal text-ink2`}>
                    {al.label}
                  </th>
                  {HORIZONS.map((h) => {
                    const o = q.data.outcomes.find((x) => x.alertId === al.id && x.horizon === h);
                    const done = o?.status === 'done' && o.excess !== null ? o.excess : null;
                    return (
                      <td
                        key={h}
                        className={`${td} ps-2.5 text-end whitespace-nowrap ${
                          done === null ? 'text-ink3' : done >= 0 ? 'text-up' : 'text-down'
                        }`}
                      >
                        {done !== null ? (
                          <Num>{signedPct(done * 100, 1)}</Num>
                        ) : o?.status === 'pending' || !o ? (
                          s.pendingCell
                        ) : (
                          s.unavailableCell
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollX>
      )}
      {thin.map((r) => (
        <div
          key={`${r.ruleId}-${r.status}`}
          className="flex flex-col gap-1.5 rounded-[10px] border border-line bg-elev px-3 py-2.5"
        >
          <span className="text-xs text-ink3">{s.ruleLabel(r.ruleId, r.status === 'shadow')}</span>
          <span className="text-sm text-ink">{s.insufficientRow(r.n)}</span>
          <span aria-hidden="true" className="flex gap-0.5">
            {Array.from({ length: 30 }, (_, i) => (
              <span
                key={i}
                className={`h-1.5 flex-1 rounded-[1px] ${i < r.n ? 'bg-ink2' : 'bg-sub'}`}
              />
            ))}
          </span>
          <span className="text-xs text-ink3">{s.hitRatesAt}</span>
        </div>
      ))}
      {enough.length > 0 && (
        <ScrollX label={s.tableLabel}>
          <table className="w-full border-collapse text-[13px] tabular-nums">
            <thead>
              <tr>
                <th className={`${th} text-start`}>{s.colRule}</th>
                <th className={`${th} text-end`}>{s.colHorizon}</th>
                <th className={`${th} text-end`}>{s.colN}</th>
                <th className={`${th} text-end`}>{s.colWin}</th>
                <th className={`${th} text-end`}>{s.colRet}</th>
                <th className={`${th} text-end`}>{s.colExcess}</th>
                <th className={`${th} text-end`}>{s.colExcursion}</th>
                <th className={`${th} text-end`}>{s.colLevels}</th>
              </tr>
            </thead>
            <tbody>
              {enough.map((r) => (
                <tr key={`${r.ruleId}-${r.status}-${r.horizon}`}>
                  <td className={td}>{s.ruleLabel(r.ruleId, r.status === 'shadow')}</td>
                  <td className={`${td} text-end`}>{r.horizon.replace('d', '')}</td>
                  <td className={`${td} text-end`}>{r.n}</td>
                  <td className={`${td} text-end`}>
                    {r.winRate === null ? '–' : share(r.winRate)}{' '}
                    {r.winCi ? `(${share(r.winCi.low)} to ${share(r.winCi.high)})` : ''}
                  </td>
                  <td className={`${td} text-end`}>{pctSigned(r.meanRet)}</td>
                  <td className={`${td} text-end`}>{pctSigned(r.meanExcess)}</td>
                  <td className={`${td} text-end`}>
                    {pctSigned(r.meanMfe)} / {pctSigned(r.meanMae)}
                  </td>
                  <td className={`${td} text-end`}>
                    {r.stops} / {r.targets}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollX>
      )}
      {pending > 0 && <p className="text-xs text-ink3">{s.pending(pending)}</p>}
      <div className="flex flex-col gap-1 border-t border-line pt-3">
        <h3 className="text-[13px] font-semibold text-ink">{s.calibration}</h3>
        {cal === null ? (
          <p className="text-xs text-ink3">{s.noCalibration}</p>
        ) : (
          <ul className="text-[13px]">
            {cal.map((b) => (
              <li key={b.low}>
                {s.bin(b.low, b.high)}: n={b.n},{' '}
                {b.ci === null || b.winRate === null
                  ? s.binInsufficient
                  : `${share(b.winRate)} (${share(b.ci.low)} to ${share(b.ci.high)})`}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
