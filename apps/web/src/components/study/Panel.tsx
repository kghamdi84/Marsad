import type { ReactNode } from 'react';
import { formatFactValue, type Metric } from '@marsad/core';
import { cardClass } from '../Card';
import { t } from '../../strings';

/** The title style every Study panel shares. */
export const panelTitle = 'text-[17px] font-semibold text-white';

/** A pulsing placeholder while a panel loads; the text says Loading for screen readers. */
export function LoadingBar() {
  return (
    <div aria-busy="true" className="flex flex-col gap-2">
      <span className="sr-only">{t.loading}</span>
      <span
        aria-hidden="true"
        className="h-4 w-2/5 animate-pulse rounded-md bg-muted/15 motion-reduce:animate-none"
      />
      <span
        aria-hidden="true"
        className="h-16 animate-pulse rounded-lg bg-muted/10 motion-reduce:animate-none"
      />
    </div>
  );
}

export const th = 'border-b border-line px-2 py-2 text-start font-medium text-muted';
export const td = 'border-b border-line px-2 py-2 align-top';
export const num = 'text-end tabular-nums';
/** Header cell for a numeric column: aligned to the end like its numbers (text-start would fight text-end). */
export const thNum = 'border-b border-line px-2 py-2 text-end font-medium text-muted';

/** A section that loads on its own: a failure here shows its own message and leaves the rest of the page alone. */
export function PanelShell({
  id,
  title,
  state,
  children,
}: {
  id: string;
  title: string;
  state: { isPending: boolean; isError: boolean; error: Error | null };
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={`${cardClass} gap-3!`}>
      <h2 id={id} className={panelTitle}>
        {title}
      </h2>
      {state.isPending && <LoadingBar />}
      {state.isError && (
        <p role="alert" className="text-down">
          {t.study.panelError(title, state.error?.message ?? '')}
        </p>
      )}
      {!state.isPending && !state.isError && children}
    </section>
  );
}

/** A dollar figure in the units a person reads (`$96.22B`, `$1.78`). Empty when there is no value. */
export const usd = (v: number | null) =>
  v === null ? '' : formatFactValue({ id: '', label: '', value: v, unit: 'usd' });

/** A reported figure: its text, a "derived" mark when no filing states it directly, and its source on hover. */
export function Cell({ m, text }: { m: Metric; text: string }) {
  if (m.value === null) return <>{t.study.financials.notReported}</>;
  return (
    <span
      title={m.filed && m.accession ? t.study.financials.source(m.filed, m.accession) : undefined}
    >
      {text}
      {m.derived && <span className="ms-1 text-xs text-muted">{t.study.financials.derived}</span>}
    </span>
  );
}
