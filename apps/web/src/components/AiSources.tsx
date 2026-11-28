import type { CitationRef } from '@marsad/core';
import { t } from '../strings';

const a = t.common.ai;

/** The model's display name, or its id when it is not in the list. */
export const modelName = (id: string | null): string => (id ? (a.models[id] ?? id) : '');

/** Why a template was shown instead of AI text, in plain words. */
export const reasonText = (reason: string | null): string =>
  (reason ? a.reasons[reason] : undefined) ?? a.unknownReason;

/**
 * The sources an AI text cites (ADR 0007): each id as it appears in the text, what it is, where it came from and
 * when it was filed, with a link to the filing when there is one. Provenance for every figure.
 */
export function AiSources({ citations, label }: { citations: CitationRef[]; label: string }) {
  if (citations.length === 0) return null;
  return (
    <details className="text-[13px]">
      <summary className="inline-flex min-h-11 cursor-pointer items-center text-ink3">
        {a.sources} ({citations.length})
      </summary>
      <ul aria-label={label} className="flex flex-col gap-1.5">
        {citations.map((c) => (
          <li key={c.id} className="flex flex-col gap-0.5 text-ink2">
            <span>
              <span className="font-semibold text-ink tabular-nums">[{c.id}]</span> {c.label}
            </span>
            <span className="text-xs text-ink3">
              {c.source}
              {c.asOf ? `, ${a.filed(c.asOf)}` : ''}
              {c.url && (
                <>
                  {' · '}
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center text-link underline underline-offset-2"
                  >
                    {a.openFiling}
                  </a>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
