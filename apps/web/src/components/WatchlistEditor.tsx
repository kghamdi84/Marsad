import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { SECTOR_ETFS } from '@marsad/core';
import { MAX_WATCHLIST, moved, saveWatchlist, setSector, withTicker } from '../lib/watchlist';
import { ErrorText } from './ui';
import { t } from '../strings';

const x = t.watchlist;

/** Add, remove and reorder the watchlist (council batch 3). Each change saves at once. */
export function WatchlistEditor({
  tickers,
  sectorOf = {},
  onDone,
}: {
  tickers: string[];
  sectorOf?: Record<string, string | null>;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [list, setList] = useState(tickers);
  const [input, setInput] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: saveWatchlist,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['watch'] });
      void qc.invalidateQueries({ queryKey: ['watchlist'] });
    },
  });
  const sector = useMutation({
    mutationFn: ({ tk, etf }: { tk: string; etf: string | null }) => setSector(tk, etf),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['watch'] }),
  });
  const apply = (next: string[]) => {
    setList(next);
    save.mutate(next);
  };
  const add = (e: FormEvent) => {
    e.preventDefault();
    const next = withTicker(list, input);
    if (!next) return setProblem(x.invalid(input.trim()));
    if (next.length > MAX_WATCHLIST) return setProblem(x.full(MAX_WATCHLIST));
    setProblem(null);
    setInput('');
    apply(next);
  };
  const iconBtn =
    'grid size-11 flex-none place-items-center rounded-full text-white disabled:opacity-30';
  return (
    <section aria-label={x.editTitle} className="flex flex-col gap-3">
      <form onSubmit={add} className="flex items-end gap-2">
        <label className="flex flex-1 flex-col gap-1 text-[13px] text-muted">
          {x.addLabel}
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="min-h-11 rounded-xl border border-line bg-bg px-3 text-base text-fg uppercase"
          />
        </label>
        <button type="submit" className="min-h-11 rounded-xl bg-white px-4 font-bold text-raised">
          {x.add}
        </button>
      </form>
      {problem && <p className="text-sm text-down">{problem}</p>}
      <ol className="flex flex-col">
        {list.map((tk, i) => (
          <li key={tk} className="flex items-center gap-1 border-t border-line-soft py-1">
            <span className="flex-1 font-bold text-white">{tk}</span>
            <select
              aria-label={x.sectorFor(tk)}
              defaultValue={sectorOf[tk] ?? ''}
              onChange={(e) => sector.mutate({ tk, etf: e.target.value || null })}
              className="min-h-11 max-w-28 rounded-lg border border-line bg-bg px-1.5 text-sm text-fg"
            >
              <option value="">{x.noSector}</option>
              {SECTOR_ETFS.map((s2) => (
                <option key={s2.ticker} value={s2.ticker}>
                  {s2.ticker}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label={x.up(tk)}
              disabled={i === 0}
              onClick={() => apply(moved(list, tk, -1))}
              className={iconBtn}
            >
              <ArrowUp aria-hidden="true" size={18} />
            </button>
            <button
              type="button"
              aria-label={x.down(tk)}
              disabled={i === list.length - 1}
              onClick={() => apply(moved(list, tk, 1))}
              className={iconBtn}
            >
              <ArrowDown aria-hidden="true" size={18} />
            </button>
            <button
              type="button"
              aria-label={x.remove(tk)}
              onClick={() => apply(list.filter((y) => y !== tk))}
              className={iconBtn}
            >
              <X aria-hidden="true" size={18} />
            </button>
          </li>
        ))}
      </ol>
      <p className="text-[13px] text-muted">{x.barsNote}</p>
      <p role="status" className="text-[13px] text-muted">
        {save.isPending ? x.saving : save.isSuccess ? x.saved : ''}
      </p>
      {save.isError && <ErrorText message={save.error.message} />}
      {sector.isError && <ErrorText message={sector.error.message} />}
      <button
        type="button"
        onClick={onDone}
        className="min-h-11 self-start rounded-xl border border-muted/35 px-4 text-white"
      >
        {x.done}
      </button>
    </section>
  );
}
