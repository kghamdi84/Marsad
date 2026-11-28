import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { t } from '../../strings';

export type MarketsView = keyof typeof t.markets.views;

/** The line under a Watch summary card that opens the matching Markets view (ADR 0048). */
export function SeeAll({ view }: { view: MarketsView }) {
  return (
    <Link
      to="/markets"
      search={{ view }}
      className="inline-flex min-h-11 items-center gap-1 self-end text-[13px] font-medium text-link underline-offset-4 hover:underline"
    >
      {t.markets.seeAll[view]}
      <ChevronRight aria-hidden="true" size={16} className="rtl:rotate-180" />
    </Link>
  );
}
