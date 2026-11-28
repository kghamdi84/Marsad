import { useQuery } from '@tanstack/react-query';
import { loadHoldings } from '../../lib/journal';
import { PositionSection } from '../quicklook/Sections';
import { tileClass } from './Panel';

/**
 * Khaled's open position in this ticker with its exit conditions, the same block the quick look shows. Nothing
 * when he does not hold it. Shares the holdings cache with the quick look.
 */
export function HeldPosition({ ticker }: { ticker: string }) {
  const q = useQuery({ queryKey: ['holdings'], queryFn: loadHoldings });
  const held = q.data?.holdings.some((h) => h.ticker === ticker);
  if (!q.data || !held) return null;
  return (
    <div className={tileClass}>
      <PositionSection ticker={ticker} holdings={q.data.holdings} bars={q.data.bars} />
    </div>
  );
}
