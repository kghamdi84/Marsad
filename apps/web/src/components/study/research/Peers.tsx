import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { sessionReturn, type DailyBar, type TauricProfile } from '@marsad/core';
import { Num } from '../../ui/kit';
import { formatUsd } from '../../../lib/study';
import { loadPeers, type Part } from '../../../lib/research';
import { t } from '../../../strings';
import { R, Signed, SourceLine, Tile, Unavailable, pctText, plain, td, tdEnd, th, thEnd } from './shared';

function Row({
  ticker,
  p,
  bars,
  self = false,
}: {
  ticker: string;
  p: TauricProfile | null;
  bars: readonly DailyBar[];
  self?: boolean;
}) {
  const y1 = sessionReturn(bars, 252);
  return (
    <tr className={self ? 'bg-elev' : undefined}>
      <th scope="row" className={`${td} font-semibold text-ink`}>
        {self ? (
          <Num>{ticker}</Num>
        ) : (
          <Link
            to="/study/$ticker"
            params={{ ticker }}
            className="inline-flex min-h-11 items-center text-link underline underline-offset-4"
          >
            <Num>{ticker}</Num>
          </Link>
        )}
      </th>
      <td className={tdEnd}>{p?.market_cap == null ? R.na : formatUsd(p.market_cap)}</td>
      <td className={tdEnd}>{p?.pe_ratio == null ? R.na : plain(p.pe_ratio, 1)}</td>
      <td className={tdEnd}>{p?.revenue_growth == null ? R.na : pctText(p.revenue_growth * 100, 1)}</td>
      <td className={tdEnd}>{p?.profit_margin == null ? R.na : pctText(p.profit_margin * 100, 1)}</td>
      <td className={tdEnd}>{y1 === null ? R.na : <Signed pct={y1} />}</td>
    </tr>
  );
}

export function PeersView({
  ticker,
  bars,
  profile,
}: {
  ticker: string;
  bars: readonly DailyBar[];
  profile: Part<TauricProfile>;
}) {
  const x = R.peers;
  const p = profile.ok ? profile.value : null;
  const q = useQuery({
    queryKey: ['research-peers', ticker, p?.sub_industry ?? null, p?.industry ?? null],
    queryFn: () => loadPeers(ticker, p?.sub_industry ?? null, p?.industry ?? null),
    enabled: p !== null,
  });
  if (!profile.ok)
    return (
      <Tile id="rs-peers" title={x.title}>
        <Unavailable reason={profile.reason} />
      </Tile>
    );
  return (
    <Tile id="rs-peers" title={x.title}>
      {q.isPending ? (
        <p className="text-sm text-ink3">{R.loading}</p>
      ) : q.isError ? (
        <p role="alert" className="text-sm text-crit">
          {t.study.panelError(x.title, q.error.message)}
        </p>
      ) : q.data.rows.length === 0 ? (
        <p className="text-sm text-ink3">{x.none(p?.sub_industry ?? p?.industry ?? R.na)}</p>
      ) : (
        <>
          <p className="text-xs text-ink3">
            {x.basis(q.data.basis === 'sub_industry' ? (p?.sub_industry ?? '') : (p?.industry ?? ''))}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <caption className="sr-only">{x.title}</caption>
              <thead>
                <tr>
                  <th className={th}>{x.cols.ticker}</th>
                  <th className={thEnd}>{x.cols.cap}</th>
                  <th className={thEnd}>{x.cols.pe}</th>
                  <th className={thEnd}>{x.cols.growth}</th>
                  <th className={thEnd}>{x.cols.margin}</th>
                  <th className={thEnd}>{x.cols.y1}</th>
                </tr>
              </thead>
              <tbody>
                <Row ticker={ticker} p={p} bars={bars} self />
                {q.data.rows.map((r) => (
                  <Row key={r.ticker} ticker={r.ticker} p={r.profile} bars={r.bars} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <SourceLine>{x.source}</SourceLine>
    </Tile>
  );
}
