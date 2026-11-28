import { impliedMove, type DailyBar, type TauricAnalyst, type TauricThesis } from '@marsad/core';
import { Num } from '../../ui/kit';
import { dayMonthYear } from '../../../lib/dates';
import type { Part } from '../../../lib/research';
import { TargetChart } from './charts';
import { R, Signed, SourceLine, Tile, Unavailable, etDay, money, th, thEnd, td, tdEnd } from './shared';

const DIST = ['strong_buy', 'buy', 'hold', 'sell', 'strong_sell'] as const;
const DIST_CLASS: Record<(typeof DIST)[number], string> = {
  strong_buy: 'bg-up',
  buy: 'bg-up/60',
  hold: 'bg-ink3',
  sell: 'bg-down/60',
  strong_sell: 'bg-down',
};

/** The consensus word and the target upside in one line, for the brief and the quick look. */
export function consensusLine(a: TauricAnalyst, close: number | null): string | null {
  const word = a.recommendation ? R.analyst.words[a.recommendation] : null;
  const move = impliedMove(a.target_mean_price, close);
  if (!word && move === null) return null;
  return R.analyst.oneLine(
    word ?? R.na,
    a.target_mean_price === null ? null : money(a.target_mean_price),
    move === null ? null : `${move >= 0 ? '+' : '−'}${Math.abs(move).toFixed(1)}%`,
  );
}

export function AnalystsView({
  ticker,
  analyst,
  bars,
}: {
  ticker: string;
  analyst: Part<TauricAnalyst>;
  bars: readonly DailyBar[];
}) {
  const x = R.analyst;
  if (!analyst.ok)
    return (
      <Tile id="rs-analyst" title={x.title}>
        <Unavailable reason={analyst.reason} />
        <p className="text-sm text-ink3">{x.perAnalyst}</p>
      </Tile>
    );
  const a = analyst.value;
  const last = bars.at(-1) ?? null;
  const counts = DIST.map((k) => ({ k, n: a[k] ?? 0 }));
  const sum = counts.reduce((s, c) => s + c.n, 0);
  const targets = [
    { key: 'mean', name: x.targets.mean, v: a.target_mean_price },
    { key: 'median', name: x.targets.median, v: a.target_median_price },
    { key: 'high', name: x.targets.high, v: a.target_high_price },
    { key: 'low', name: x.targets.low, v: a.target_low_price },
  ] as const;
  const closes = bars.slice(-253).map((b) => b.close);
  const lines = [
    { name: x.targets.high, value: a.target_high_price, className: 'text-up' },
    { name: x.targets.mean, value: a.target_mean_price, className: 'text-ink' },
    { name: x.targets.low, value: a.target_low_price, className: 'text-down' },
  ].filter((l): l is { name: string; value: number; className: string } => l.value !== null);
  const asOf = analyst.asOf ? etDay(analyst.asOf) : R.na;
  return (
    <Tile id="rs-analyst" title={x.title} aside={<span className="text-xs text-ink3">{x.opinion}</span>}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[22px] font-semibold text-ink">
          {a.recommendation ? x.words[a.recommendation] : R.na}
        </span>
        <span className="text-sm text-ink2">
          <Num>{x.basis(a.ratings_total, a.number_of_analysts)}</Num>
        </span>
      </div>
      {sum > 0 && (
        <div className="flex flex-col gap-1.5">
          <div
            role="img"
            aria-label={x.distAria(counts.map((c) => `${x.dist[c.k]} ${c.n}`).join(', '))}
            className="flex h-3 overflow-hidden rounded-full bg-sub"
          >
            {counts.map((c) =>
              c.n > 0 ? (
                <span key={c.k} className={DIST_CLASS[c.k]} style={{ width: `${(c.n / sum) * 100}%` }} />
              ) : null,
            )}
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {counts.map((c) => (
              <li key={c.k} className="inline-flex items-center gap-1.5 text-ink2">
                <span aria-hidden="true" className={`inline-block size-2.5 rounded-sm ${DIST_CLASS[c.k]}`} />
                {x.dist[c.k]} <Num className="font-semibold text-ink">{c.n}</Num>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <caption className="sr-only">{x.targetsCaption}</caption>
          <thead>
            <tr>
              <th className={th}>{x.colTarget}</th>
              <th className={thEnd}>{x.colPrice}</th>
              <th className={thEnd}>{last ? x.colMove(dayMonthYear(last.date), money(last.close)) : x.colMoveNone}</th>
            </tr>
          </thead>
          <tbody>
            {targets.map((tg) => {
              const m = impliedMove(tg.v, last?.close);
              return (
                <tr key={tg.key}>
                  <th scope="row" className={`${td} font-medium text-ink`}>
                    {tg.name}
                  </th>
                  <td className={tdEnd}>{tg.v === null ? R.na : money(tg.v)}</td>
                  <td className={tdEnd}>{m === null ? R.na : <Signed pct={m} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {lines.length > 0 && last && (
        <TargetChart
          label={x.chartAria(
            ticker,
            dayMonthYear(bars[Math.max(0, bars.length - 253)]?.date ?? last.date),
            dayMonthYear(last.date),
            lines.map((l) => `${l.name} ${money(l.value)}`).join(', '),
          )}
          closes={closes}
          targets={lines}
        />
      )}
      <p className="text-xs text-ink3">{x.chartNote}</p>
      <p className="text-sm text-ink3">{x.perAnalyst}</p>
      <SourceLine>{x.source(asOf)}</SourceLine>
    </Tile>
  );
}

export function AiView({ thesis }: { thesis: Part<TauricThesis> }) {
  const x = R.ai;
  if (!thesis.ok)
    return (
      <Tile id="rs-ai" title={x.title}>
        <Unavailable reason={thesis.reason} />
      </Tile>
    );
  const th0 = thesis.value;
  const list = (id: string, title: string, items: readonly string[]) => (
    <section aria-labelledby={id} className="flex flex-col gap-1">
      <h3 id={id} className="text-xs font-semibold text-ink2">
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="text-sm text-ink3">{x.none}</p>
      ) : (
        <ul className="flex list-disc flex-col gap-1.5 ps-5 text-sm text-ink2">
          {items.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      )}
    </section>
  );
  return (
    <Tile id="rs-ai" title={x.title}>
      <p className="rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-sm font-medium text-ink">
        <Num>{x.label(etDay(th0.generated_at), th0.cutoff ? etDay(th0.cutoff) : R.na)}</Num>
      </p>
      <p className="text-sm text-ink">{th0.narrative}</p>
      <div className="grid grid-cols-1 gap-4 tablet:grid-cols-2">
        {list('rs-ai-pos', x.positive, th0.drivers.map((d) => d.text))}
        {list('rs-ai-neg', x.negative, th0.risks.map((d) => d.text))}
      </div>
      <section aria-labelledby="rs-ai-cat" className="flex flex-col gap-1">
        <h3 id="rs-ai-cat" className="text-xs font-semibold text-ink2">
          {x.catalysts}
        </h3>
        {th0.catalysts.length === 0 ? (
          <p className="text-sm text-ink3">{x.none}</p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-sm text-ink2">
            {th0.catalysts.map((c, i) => (
              <li key={i} className="flex gap-3">
                <Num className="w-24 flex-none text-ink3">
                  {c.date ? dayMonthYear(c.date) : (c.timing_stated ?? x.undated)}
                </Num>
                <span>{c.text}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {list('rs-ai-q', x.questions, th0.open_questions)}
      <SourceLine>{x.source(th0.revision ?? R.na)}</SourceLine>
    </Tile>
  );
}
