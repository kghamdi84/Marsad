import { Link } from '@tanstack/react-router';
import { Calculator } from 'lucide-react';
import { t } from '../../strings';

/**
 * "Size a trade" (ADR 0048): opens Journal's sizer with the ticker filled in. Sizing comes before any order; Marsad
 * never places one.
 */
export function SizeTradeLink({ ticker, className = '' }: { ticker: string; className?: string }) {
  return (
    <Link
      to="/journal"
      search={{ view: 'sizer', ticker }}
      aria-label={t.study.sizeTradeAria(ticker)}
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-[13px] font-semibold text-ink hover:bg-elev ${className}`}
    >
      <Calculator aria-hidden="true" size={16} className="text-ink3" />
      {t.study.sizeTrade}
    </Link>
  );
}
