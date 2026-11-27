import { COMPONENT_SOURCES, type ComponentKey } from '@marsad/core';
import { Info } from '../Info';
import { Card, Details, ScrollX } from '../Card';
import { num, td, th, thNum } from '../study/Panel';
import { fixed, pct, signedFixed, width } from './format';
import type { RegimeData, StoredFearGreedDay } from '../../lib/regime';
import { t } from '../../strings';

const r = t.regime;
const u = r.ui;
const f = r.fearGreed;

function componentValue(key: ComponentKey, v: number): string {
  switch (key) {
    case 'momentum':
    case 'volatility':
    case 'safeHaven':
      return pct(v);
    case 'strength':
      return f.ofMembers(pct(v));
    case 'breadth':
      return signedFixed(v, 1);
    case 'putCall':
      return fixed(v, 2);
    case 'junk':
      return f.points(fixed(v, 2));
  }
}

/** Score tone by the published bands: greed blue, fear orange, neutral grey. Words carry the meaning. */
const toneText = (score: number) =>
  score >= 56 ? 'text-up' : score <= 44 ? 'text-down' : 'text-ink2';
const toneBar = (score: number) => (score >= 56 ? 'bg-up' : score <= 44 ? 'bg-down' : 'bg-ink3');

/** Marsad's Fear and Greed composite: the value, its label, and the 7 components with their scores. */
export function FearGreed({ data }: { data: RegimeData }) {
  const withComposite = data.fearGreed.filter((d) => d.composite !== null);
  const last = withComposite.at(-1);
  const newest = data.fearGreed.at(-1);
  if (!last || last.composite === null)
    return (
      <Card id="fear-greed" title={f.title} subtitle={f.intro}>
        <p className="text-sm text-ink3">{f.none}</p>
        {newest && <p className="text-sm text-ink3">{f.newer(newest.date, newest.available)}</p>}
      </Card>
    );
  const monthAgo: StoredFearGreedDay | undefined = withComposite.at(-22);
  const v = Math.round(last.composite);
  return (
    <Card
      id="fear-greed"
      title={f.title}
      subtitle={`${f.count(last.available)}. ${f.asOf(last.date, last.version)}`}
    >
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span
          data-testid="fear-greed-value"
          className="text-[34px] leading-none font-semibold text-ink"
        >
          {v}
        </span>
        <span data-testid="fear-greed-label" className={`font-semibold ${toneText(v)}`}>
          {f.labels[last.label ?? ''] ?? ''}
        </span>
        {monthAgo?.composite != null && (
          <span className="text-xs text-ink3">
            {f.monthAgo(Math.round(monthAgo.composite), monthAgo.date)}
          </span>
        )}
      </div>
      {newest && newest.date !== last.date && (
        <p className="text-sm text-ink3">{f.newer(newest.date, newest.available)}</p>
      )}
      <ul className="flex flex-col">
        {last.components.map((c) => (
          <li key={c.key} className="flex flex-col gap-1.5 border-t border-line py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-ink2">{f.short[c.key] ?? c.key}</span>
              <span
                className={`text-sm font-semibold whitespace-nowrap ${c.score === null ? 'text-ink3' : 'text-ink'}`}
              >
                {c.score === null ? u.unavailable : Math.round(c.score)}
              </span>
            </div>
            <span aria-hidden="true" className="relative block h-2 rounded bg-sub">
              {c.score !== null && (
                <span
                  className={`absolute inset-y-0 start-0 rounded ${toneBar(c.score)}`}
                  style={{ width: width(c.score / 100) }}
                />
              )}
            </span>
            {c.score === null && (
              <span className="text-xs text-ink3">{f.reasons[c.reason ?? 'no-data']}</span>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-ink3">{f.bands}</p>
      <Details>
        <Info>{f.intro}</Info>
        <ScrollX label={u.tables.components}>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={th}>{f.colComponent}</th>
                <th className={thNum}>{f.colValue}</th>
                <th className={thNum}>{f.colScore}</th>
                <th className={th}>{f.colSource}</th>
              </tr>
            </thead>
            <tbody>
              {last.components.map((c) => (
                <tr key={c.key}>
                  <td className={td}>{f.names[c.key] ?? c.key}</td>
                  <td className={`${td} ${num}`}>
                    {c.value === null ? r.noData : componentValue(c.key, c.value)}
                  </td>
                  <td className={`${td} ${num}`}>
                    {c.score === null ? (
                      <span className="text-ink3">{f.reasons[c.reason ?? 'no-data']}</span>
                    ) : (
                      <>
                        {Math.round(c.score)}
                        <span className="block text-xs text-ink3">{f.windowNote(c.window)}</span>
                      </>
                    )}
                  </td>
                  <td className={td}>
                    <span className="text-xs text-ink3">{COMPONENT_SOURCES[c.key]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollX>
        <Info>{f.method}</Info>
      </Details>
    </Card>
  );
}
