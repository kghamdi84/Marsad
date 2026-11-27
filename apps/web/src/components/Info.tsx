import type { ReactNode } from 'react';
import { Info as InfoIcon } from 'lucide-react';
import { t } from '../strings';

/**
 * How a figure was made, behind one tap (council batch 2: "show what it is and how old it is; put how it was made
 * behind ⓘ"). Freshness words, as-of dates, "estimated", case counts and disclosure lags never go in here: they
 * stay next to the value they qualify.
 */
export function Info({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <details className={`group text-muted ${className}`}>
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-[13px] select-none [&::-webkit-details-marker]:hidden">
        <InfoIcon aria-hidden="true" size={15} />
        <span className="underline decoration-dotted underline-offset-4 group-open:no-underline">
          {t.info.label}
        </span>
      </summary>
      <div className="flex flex-col gap-1.5 pb-2 text-[13px] leading-relaxed">{children}</div>
    </details>
  );
}
