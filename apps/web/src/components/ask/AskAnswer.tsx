import { Fragment } from 'react';
import { Link } from '@tanstack/react-router';
import { dualClock, etDate, type AskCitation } from '@marsad/core';
import { useDisplay } from '../../lib/display';
import { dayMonth } from '../../lib/dates';
import { Num } from '../ui/kit';
import { t } from '../../strings';

const s = t.ask;
const CITE = /(\[[A-Z]\d+(?:\s*,\s*[A-Z]\d+)*\])/g;

/** An instant as "27 Nov 14:05 ET (22:05 local)": ET next to the viewer's zone (integrity rule 7). */
export function useWhen() {
  const { zone } = useDisplay();
  return (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return `${dayMonth(etDate(d))} ${dualClock(d, zone).label}`;
  };
}

/** The answer text with each citation id replaced by its number in the source list, linked to it. */
function AnswerText({
  text,
  numbers,
  prefix,
}: {
  text: string;
  numbers: Map<string, number>;
  prefix: string;
}) {
  const parts = text.split(CITE);
  return (
    <p className="text-[0.9375rem] leading-relaxed whitespace-pre-line text-ink">
      {parts.map((part, i) => {
        if (!/^\[[A-Z]\d+/.test(part)) return <Fragment key={i}>{part}</Fragment>;
        const ids = part
          .slice(1, -1)
          .split(',')
          .map((x) => x.trim());
        return (
          <span key={i} className="whitespace-nowrap">
            {ids.map((id) => {
              const n = numbers.get(id);
              if (n === undefined) return null;
              return (
                <a
                  key={id}
                  href={`#${prefix}-${n}`}
                  aria-label={s.sourceAria(n)}
                  className="ms-0.5 align-super text-xs font-semibold text-up underline-offset-2 hover:underline"
                >
                  [{n}]
                </a>
              );
            })}
          </span>
        );
      })}
    </p>
  );
}

function PageLink({ c }: { c: AskCitation }) {
  const cls =
    'inline-flex min-h-11 items-center text-sm font-semibold text-up underline-offset-4 hover:underline';
  const l = c.link;
  if (!l) return null;
  if (l.page === 'study' && l.ticker)
    return (
      <Link
        to="/study/$ticker"
        params={{ ticker: l.ticker }}
        search={l.view ? { view: l.view } : {}}
        className={cls}
      >
        {s.openPage}
      </Link>
    );
  if (l.page === 'markets')
    return (
      <Link to="/markets" search={l.view ? { view: l.view } : {}} className={cls}>
        {s.openPage}
      </Link>
    );
  if (l.page === 'portfolio')
    return (
      <Link to="/portfolio" search={l.view ? { view: l.view } : {}} className={cls}>
        {s.openPage}
      </Link>
    );
  if (l.page === 'alerts')
    return (
      <Link to="/alerts" className={cls}>
        {s.openPage}
      </Link>
    );
  return null;
}

/** One answer: its label, the text with numbered citations, model, as-of and cost, then the source list. */
export function AskAnswer({
  answer,
  citations,
  verified,
  model,
  asOf,
  usd,
  prefix,
  note,
}: {
  answer: string;
  citations: readonly AskCitation[];
  verified: boolean;
  model: string | null;
  asOf: string | null;
  usd: number | null;
  /** Unique per answer on the page, so citation anchors do not collide. */
  prefix: string;
  /** Why this is facts only, when it is. */
  note?: string | null;
}) {
  const when = useWhen();
  const numbers = new Map(citations.map((c, i) => [c.id, i + 1]));
  return (
    <div className="flex flex-col gap-3">
      <p
        className={`self-start rounded-md px-2 py-0.5 text-xs font-medium ${verified ? 'bg-up-soft text-up' : 'bg-sub text-ink2'}`}
      >
        {verified ? s.aiLabel : s.factsLabel}
      </p>
      {note && <p className="text-sm text-fg">{note}</p>}
      {answer !== '' && <AnswerText text={answer} numbers={numbers} prefix={prefix} />}
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink3">
        {model && <span>{s.model(model)}</span>}
        {asOf && (
          <span>
            <Num>{s.asOf(when(asOf))}</Num>
          </span>
        )}
        {usd !== null && usd > 0 && <span>{s.cost(usd)}</span>}
      </p>
      {citations.length > 0 && (
        <section aria-label={s.sources} className="flex flex-col gap-1.5">
          <h3 className="text-sm font-semibold text-ink">{s.sources}</h3>
          <ol className="flex flex-col gap-2">
            {citations.map((c, i) => (
              <li
                key={c.id}
                id={`${prefix}-${i + 1}`}
                className="flex scroll-mt-20 flex-col gap-0.5 rounded-lg border border-line bg-elev px-3 py-2 text-sm"
              >
                <span className="text-ink">
                  <span className="font-semibold tabular-nums">{i + 1}.</span>{' '}
                  {c.kind === 'fact' ? (
                    <>
                      {c.label}: <Num className="font-semibold">{c.text}</Num>
                    </>
                  ) : (
                    c.label
                  )}
                </span>
                <span className="text-xs text-ink3">
                  {c.source === 'Marsad (ADR 0054)' ? s.scopeSource : c.source}
                  {c.asOf && (
                    <>
                      {' · '}
                      <Num>{when(c.asOf)}</Num>
                    </>
                  )}
                </span>
                <span className="flex flex-wrap gap-x-4">
                  <PageLink c={c} />
                  {c.url && (
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-11 items-center text-sm font-semibold text-up underline-offset-4 hover:underline"
                    >
                      {s.openFiling} <span className="sr-only">{s.opensNewTab}</span>
                    </a>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
