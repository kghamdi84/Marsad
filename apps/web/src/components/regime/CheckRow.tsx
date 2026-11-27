import type { ReactNode } from 'react';
import { Pill, type Tone } from '../ui/kit';

/**
 * The v2 condition row (Why this label, recession filter, capitulation watch): an inner tile with the condition,
 * a state or value pill on the end side and an optional note line. The pill's text carries the meaning.
 */
export function CheckRow({
  text,
  pill,
  tone = 'neutral',
  note,
}: {
  text: ReactNode;
  pill: ReactNode;
  tone?: Tone;
  note?: ReactNode;
}) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-0.5 rounded-[10px] border border-line bg-elev px-3 py-2.5">
      <span className="text-[13px] font-medium text-ink">{text}</span>
      <Pill tone={tone} className="font-semibold">
        {pill}
      </Pill>
      {note && <span className="col-span-full text-xs text-ink3">{note}</span>}
    </li>
  );
}
