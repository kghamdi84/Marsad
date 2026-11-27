import { correlationPairs, exposureReport, toFixedHalfUp, type DatedValue } from '@marsad/core';
import { BarRow } from '../ui/kit';
import { cardClass } from '../Card';
import type { BarsByTicker, StoredHolding } from '../../lib/journal';
import { dayMonthYear } from '../../lib/dates';
import {
  CardHead,
  LineRow,
  lineRowClass,
  newestClose,
  positionsOf,
  share,
  signedPct1,
  signedUsd,
} from './shared';
import { t } from '../../strings';

const x = t.journal.exposure;

/** The design's "Exposure" card: beta to SPY, sectors, highly correlated pairs and the stress scenarios. */
export function Exposure({
  holdings,
  bars,
  vix,
}: {
  holdings: StoredHolding[];
  bars: BarsByTicker;
  vix: DatedValue[];
}) {
  const positions = positionsOf(holdings, bars, vix);
  if (positions.length === 0)
    return (
      <section aria-labelledby="exposure" className={cardClass}>
        <CardHead id="exposure" title={x.title} />
        <p className="text-sm text-ink3">{x.none}</p>
      </section>
    );
  const r = exposureReport(positions);
  const pairs = correlationPairs(
    [...new Set(holdings.map((h) => h.ticker))].map((tk) => ({ ticker: tk, bars: bars[tk] ?? [] })),
  ).filter((p) => p.high);
  const notes = [...new Set(r.scenarios.flatMap((sc) => sc.assumptions))];
  const asOf = newestClose(holdings, bars);
  return (
    <section aria-labelledby="exposure" className={cardClass}>
      <CardHead
        id="exposure"
        title={x.title}
        aside={
          <span className="text-xs text-ink3 tabular-nums">
            {x.betaAside(toFixedHalfUp(r.portfolioBeta, 2))}
          </span>
        }
      />
      {r.betaAssumed.length > 0 && (
        <p className="text-xs text-ink3">{x.betaAssumed(r.betaAssumed.join(', '))}</p>
      )}
      <h3 className="sr-only">{x.sectorsTitle}</h3>
      <ul className="flex flex-col">
        {r.sectors.map((sc, i) => (
          <li key={sc.sector} className="border-t border-line py-2.5">
            <BarRow
              label={sc.sector}
              value={share(sc.weight)}
              width={sc.weight * 100}
              barClass={i === 0 ? 'bg-up' : 'bg-ink3'}
            />
          </li>
        ))}
      </ul>
      <h3 className="pt-1.5 text-[13px] font-semibold text-ink">{x.corrTitle}</h3>
      {pairs.length === 0 ? (
        <p className="text-xs text-ink3">{x.corrNone}</p>
      ) : (
        <ul className="flex flex-col">
          {pairs.map((p) => (
            <li key={`${p.a}-${p.b}`} className={lineRowClass}>
              <LineRow
                k={x.corrPair(p.a, p.b)}
                v={toFixedHalfUp(p.correlation, 2)}
                tone="text-warn"
              />
            </li>
          ))}
        </ul>
      )}
      <h3 className="pt-1.5 text-[13px] font-semibold text-ink">{x.scenariosTitle}</h3>
      <ul className="flex flex-col">
        {r.scenarios.map((sc) => {
          // With no VIX sensitivity for any holding the estimate is empty, not zero: say so.
          const none =
            sc.name.startsWith('VIX') && positions.every((p) => p.vixSensitivity === null);
          return (
            <li key={sc.name} className={lineRowClass}>
              <LineRow
                k={sc.name}
                v={none ? x.unavailable : signedUsd(sc.usd)}
                note={none ? x.vixNone : x.ofPortfolio(signedPct1(sc.pct))}
                tone={none ? 'text-ink3' : sc.usd < 0 ? 'text-down' : 'text-up'}
              />
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-ink3">{notes.join(' ')}</p>
      {asOf && <p className="text-xs text-ink3">{x.asOf(dayMonthYear(asOf), r.version)}</p>}
    </section>
  );
}
