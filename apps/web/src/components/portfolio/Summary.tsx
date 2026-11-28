import { useQuery } from '@tanstack/react-query';
import { exitSignals, exposureReport, portfolioTotals, toFixedHalfUp } from '@marsad/core';
import { ErrorText } from '../ui';
import { SkeletonCards } from '../Card';
import { EtfLookThrough } from '../journal/EtfLookThrough';
import { Exposure } from '../journal/Exposure';
import { StatTile, newestClose, positionsOf, signedPct1, signedUsd, usd0 } from '../journal/shared';
import { loadHoldings } from '../../lib/journal';
import { dayMonth } from '../../lib/dates';
import { t } from '../../strings';

const ui = t.journal.ui;

/**
 * The Portfolio page's summary card: the four numbers to read first (value, open gain, beta to SPY and what needs
 * a look), moved from Journal with the portfolio views (ADR 0048).
 */
export function PortfolioSummary() {
  const q = useQuery({ queryKey: ['holdings'], queryFn: loadHoldings });
  if (q.isPending) return <SkeletonCards heights={['5.5rem']} />;
  if (!q.data || q.data.holdings.length === 0) return null;
  const { holdings, bars, vix } = q.data;
  const last = (tk: string) => bars[tk]?.at(-1)?.close ?? null;
  const tot = portfolioTotals(holdings, last);
  const positions = positionsOf(holdings, bars, vix);
  const r = positions.length > 0 ? exposureReport(positions) : null;
  const newest = newestClose(holdings, bars);
  const attention = holdings.flatMap((h) => {
    const hasRules = h.stop !== null || h.targets.length > 0 || h.trendBreak || h.timeStopSessions;
    if (!hasRules) return [`${h.ticker} ${ui.attentionKinds['rules'] ?? ''}`];
    return exitSignals(h, bars[h.ticker] ?? []).map(
      (e) => `${h.ticker} ${ui.attentionKinds[e.kind] ?? e.kind}`,
    );
  });
  const flagged = new Set(attention.map((a) => a.split(' ')[0])).size;
  const cost = tot.value - tot.gainUsd;
  return (
    <section
      aria-label={ui.kpis}
      className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,150px),1fr))] gap-2.5"
    >
      <StatTile
        label={ui.value}
        value={`$${usd0(tot.value)}`}
        sub={
          tot.unpriced.length > 0
            ? ui.unpriced(tot.unpriced.length)
            : ui.valueSub(holdings.length, newest ? dayMonth(newest) : '')
        }
      />
      <StatTile
        label={ui.gain}
        value={signedUsd(tot.gainUsd)}
        sub={
          tot.gainPct === null ? undefined : ui.gainSub(signedPct1(tot.gainPct), `$${usd0(cost)}`)
        }
        tone={tot.gainUsd >= 0 ? 'text-up' : 'text-down'}
      />
      <StatTile
        label={ui.beta}
        value={r ? toFixedHalfUp(r.portfolioBeta, 2) : t.regime.noData}
        sub={r ? ui.betaSub(Math.round((r.portfolioBeta - 1) * 100)) : ui.betaNone}
        tone={r ? 'text-ink' : 'text-ink3'}
      />
      <StatTile
        label={ui.attention}
        value={String(flagged)}
        sub={attention.length ? attention.slice(0, 3).join(' · ') : ui.noneAttention}
        tone={flagged > 0 ? 'text-down' : 'text-ink'}
      />
    </section>
  );
}

/** Exposure and the ETF look-through side by side (auto-fit, min 380 px), as the design pairs them. */
export function ExposurePanel() {
  const q = useQuery({ queryKey: ['holdings'], queryFn: loadHoldings });
  if (q.isError) return <ErrorText message={q.error.message} />;
  if (!q.data) return <SkeletonCards heights={['16rem']} />;
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,380px),1fr))] items-start gap-4">
      <Exposure holdings={q.data.holdings} bars={q.data.bars} vix={q.data.vix} />
      <EtfLookThrough holdings={q.data.holdings} bars={q.data.bars} />
    </div>
  );
}
