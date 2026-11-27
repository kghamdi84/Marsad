import type { RecessionSignal } from '@marsad/core';
import { Card, Details, ScrollX } from '../Card';
import { Pill, type Tone } from '../ui/kit';
import { td, th } from '../study/Panel';
import { CheckRow } from './CheckRow';
import { fixed, signedFixed } from './format';
import type { RegimeData } from '../../lib/regime';
import { t } from '../../strings';

const r = t.regime;
const u = r.ui;
const rec = r.recession;

/** The value with its detail, for the details table. */
function signalValue(s: RecessionSignal): string {
  if (s.value === null) return '';
  switch (s.id) {
    case 'curve':
      return `${signedFixed(s.value)} (${rec.curveDetail(s.detail['invertedSessions'] ?? 0)})`;
    case 'credit':
      return s.detail['change63'] === null || s.detail['change63'] === undefined
        ? fixed(s.value)
        : `${fixed(s.value)} (${rec.creditDetail(signedFixed(s.detail['change63']))})`;
    case 'claims':
      return `${fixed(s.value, 0)} (${rec.claimsDetail(fixed(s.detail['low52w'] ?? 0, 0))})`;
    default:
      return fixed(s.value, s.id === 'nfci' ? 3 : 2);
  }
}

/** The short value for the row pill. */
function signalShort(s: RecessionSignal): string {
  if (s.value === null) return r.noData;
  if (s.id === 'claims') return fixed(s.value, 0);
  if (s.id === 'curve') return signedFixed(s.value);
  return s.id === 'nfci' ? signedFixed(s.value, 3) : fixed(s.value);
}

const STATE_TONE: Record<string, Tone> = { triggered: 'down', clear: 'up', unavailable: 'neutral' };
const LEVEL_TONE: Record<string, Tone> = {
  low: 'up',
  elevated: 'warn',
  high: 'crit',
  unavailable: 'neutral',
};

/** The recession filter: its level, and the 5 signals with their rule, state, source and data date. */
export function Recession({ data }: { data: RegimeData }) {
  const last = data.days.at(-1);
  if (!last) return null;
  const level = last.recessionLevel;
  return (
    <Card
      id="recession"
      title={rec.title}
      subtitle={`${last.recessionVersion} · ${rec.summary(last.available, last.triggered)}`}
      aside={
        <Pill tone={LEVEL_TONE[level] ?? 'neutral'} className="font-semibold">
          <span>{rec.level[level] ?? level}</span>
          {` · ${u.ofAvailable(last.triggered, last.available)}`}
        </Pill>
      }
    >
      <ul className="flex flex-col gap-1.5">
        {last.signals.map((s) => (
          <CheckRow
            key={s.id}
            text={rec.names[s.id] ?? s.id}
            pill={signalShort(s)}
            tone={STATE_TONE[s.state] ?? 'neutral'}
            note={[
              rec.states[s.state] ?? s.state,
              u.triggers(rec.rules[s.id] ?? ''),
              s.asOf ? u.fredData(s.source, s.asOf) : u.fred(s.source),
            ].join(' · ')}
          />
        ))}
      </ul>
      <Details>
        <p className="text-sm text-ink3">{rec.rule}</p>
        <ScrollX label={u.tables.signals}>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={th}>{rec.colSignal}</th>
                <th className={th}>{rec.colState}</th>
                <th className={th}>{rec.colValue}</th>
                <th className={th}>{rec.colRule}</th>
                <th className={th}>{rec.colAsOf}</th>
              </tr>
            </thead>
            <tbody>
              {last.signals.map((s) => (
                <tr key={s.id}>
                  <td className={td}>
                    {rec.names[s.id] ?? s.id}
                    <span className="block text-xs text-ink3">{u.fred(s.source)}</span>
                  </td>
                  <td className={`${td} font-medium ${s.state === 'triggered' ? 'text-down' : ''}`}>
                    {rec.states[s.state] ?? s.state}
                  </td>
                  <td className={td}>{signalValue(s)}</td>
                  <td className={`${td} text-ink3`}>{rec.rules[s.id] ?? ''}</td>
                  <td className={`${td} whitespace-nowrap`}>{s.asOf ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollX>
        <p className="text-xs text-ink3">{rec.creditNote}</p>
      </Details>
    </Card>
  );
}
