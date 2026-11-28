import { Num } from '../../ui/kit';
import { dayMonthYear } from '../../../lib/dates';
import { targetLine } from './Analysts';
import { useCompanyResearch } from './Research';
import { R, reasonText } from './shared';

/**
 * The mean analyst target against the last stored close, in one line, with the consensus word and its source.
 * Used by the company brief and the quick look; reads the same research row as the research tab.
 */
export function AnalystLine({
  ticker,
  close,
}: {
  ticker: string;
  close: { value: number; date: string } | null;
}) {
  const q = useCompanyResearch(ticker);
  if (q.isPending) return <span className="text-ink3">{R.loading}</span>;
  if (q.isError || !q.data) return <span className="text-ink3">{R.na}</span>;
  const a = q.data.analyst;
  if (!a.ok)
    return (
      <span className="text-ink3">
        {R.na} ({reasonText(a.reason)})
      </span>
    );
  const line = targetLine(a.value, close?.value ?? null, a.asOf);
  if (!line) return <span className="text-ink3">{R.na}</span>;
  return (
    <span className="flex flex-col gap-0.5">
      <Num>{line}</Num>
      <span className="text-xs text-ink3">
        <Num>
          {R.analyst.oneLineSource(
            a.value.recommendation ? R.analyst.words[a.value.recommendation] : R.na,
            close ? dayMonthYear(close.date) : R.na,
          )}
        </Num>
      </span>
    </span>
  );
}
