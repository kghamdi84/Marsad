import { useQuery } from '@tanstack/react-query';
import { Info } from '../Info';
import { ErrorText } from '../ui';
import { Pill } from '../ui/kit';
import { AiSources, modelName, reasonText } from '../AiSources';
import { isVerifiedModelText, loadLatestAiOutput } from '../../lib/ai';
import { t } from '../../strings';
import { LoadingBar, panelTitle, tileClass } from './Panel';

const k = t.study.aiSummary;

/**
 * The filing summary (checklist 2.9, ADR 0007): Claude's summary of the newest stored filings, shown only when the
 * verifier passed it, labelled as AI text with its model, date and every cited source. When the model was capped,
 * declined or failed the check, the figures themselves are shown with the reason. Unavailable before the first run.
 */
export function AiFilingSummary({ ticker }: { ticker: string }) {
  const q = useQuery({
    queryKey: ['ai-output', 'filing-summary', ticker],
    queryFn: () => loadLatestAiOutput('filing-summary', ticker),
  });
  const o = q.data;
  const newest = o?.citations
    .map((c) => c.asOf)
    .filter((d): d is string => d !== null)
    .sort()
    .at(-1);
  return (
    <section aria-labelledby="ai-summary" className={tileClass}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="ai-summary" className={panelTitle}>
          {o && !isVerifiedModelText(o) ? k.templateTitle : k.title}
        </h2>
        {isVerifiedModelText(o) && <Pill tone="neutral">{k.label}</Pill>}
      </div>
      <Info>{k.intro}</Info>
      {q.isPending && <LoadingBar />}
      {q.isError && <ErrorText message={q.error.message} />}
      {o === null && <p className="text-sm text-ink3">{k.none}</p>}
      {o && (
        <>
          {isVerifiedModelText(o) ? (
            <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-ink2">{o.text}</p>
          ) : (
            <>
              <p className="text-xs text-ink3">{k.templateNote(reasonText(o.fallbackReason))}</p>
              <ul className="flex flex-col gap-1 text-[13px] text-ink2">
                {o.text.split('\n').map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          )}
          <p className="text-xs text-ink3">
            {isVerifiedModelText(o)
              ? t.common.ai.asOf(o.createdAt.slice(0, 10), modelName(o.servedModel ?? o.model))
              : null}
            {newest ? ` ${t.common.ai.newest(newest)}` : ''}
          </p>
          <AiSources citations={o.citations} label={k.title} />
        </>
      )}
    </section>
  );
}
