import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { normalizeTicker } from '@marsad/core';
import { supabase } from '../../lib/supabase';
import { t } from '../../strings';

const s = t.study;

interface Match {
  ticker: string;
  name: string | null;
}

/**
 * Companies whose ticker is the text, or whose stored name contains it. Only letters, digits, spaces and a few
 * name characters reach the query, so the text cannot change the filter's syntax.
 */
async function findCompanies(text: string): Promise<Match[]> {
  if (!supabase) return [];
  const words = text
    .replace(/[^A-Za-z0-9 .&-]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  if (words === '') return [];
  const asTicker = normalizeTicker(words);
  const filters = [`name.ilike."*${words}*"`];
  if (asTicker) filters.push(`ticker.eq.${asTicker}`);
  const r = await supabase
    .from('instruments')
    .select('ticker, name')
    .or(filters.join(','))
    .limit(8);
  if (r.error) return [];
  return ((r.data ?? []) as { ticker: unknown; name: unknown }[])
    .filter((x) => typeof x.ticker === 'string')
    .map((x) => ({ ticker: x.ticker as string, name: typeof x.name === 'string' ? x.name : null }));
}

/**
 * Search by ticker or company name (v2 header search). An exact ticker opens it; one name match opens that
 * company; several are listed to choose from; no match opens the text as a ticker when it is a valid one.
 */
export function CompanySearch({
  id,
  label,
  showLabel = false,
  button = false,
  className = '',
}: {
  id: string;
  label: string;
  /** Show the label above the field (the list page); otherwise it names the field for assistive technology. */
  showLabel?: boolean;
  /** An Open button beside the field (the list page); the header submits with Enter. */
  button?: boolean;
  className?: string;
}) {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [busy, setBusy] = useState(false);

  const go = (ticker: string) => {
    setMatches([]);
    setText('');
    void navigate({ to: '/study/$ticker', params: { ticker } });
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    const q = text.trim();
    if (q === '') return;
    setError(null);
    setBusy(true);
    const found = await findCompanies(q);
    setBusy(false);
    const asTicker = normalizeTicker(q);
    const exact = found.find((m) => m.ticker === asTicker);
    if (exact) return go(exact.ticker);
    if (found.length === 1 && found[0]) return go(found[0].ticker);
    if (found.length > 1) return setMatches(found);
    if (asTicker) return go(asTicker);
    setMatches([]);
    setError(/^[A-Za-z0-9 .&-]+$/.test(q) ? s.ui.searchNone(q) : s.badTicker(q));
  }

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <form onSubmit={submit} role="search" className="flex flex-col gap-1.5">
        <label htmlFor={id} className={showLabel ? 'text-sm text-ink3' : 'sr-only'}>
          {label}
        </label>
        <div className="flex gap-2">
          <span className="relative min-w-0 flex-1">
            <Search
              aria-hidden="true"
              size={16}
              className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink3"
            />
            <input
              id={id}
              type="search"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setError(null);
                setMatches([]);
              }}
              placeholder={s.search}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              aria-describedby={error ? `${id}-error` : undefined}
              className="min-h-11 w-full rounded-[10px] border border-line-strong bg-surface ps-9 pe-3 text-[15px] text-ink placeholder:text-ink3"
            />
          </span>
          {button && (
            <button
              type="submit"
              className="min-h-11 rounded-lg bg-accent px-5 text-sm font-semibold text-accent-ink"
            >
              {s.open}
            </button>
          )}
        </div>
      </form>
      {busy && (
        <p role="status" className="text-xs text-ink3">
          {s.ui.searching}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-crit">
          {error}
        </p>
      )}
      {matches.length > 0 && (
        <nav aria-label={s.ui.searchMatches}>
          <ul className="flex flex-col rounded-[10px] border border-line bg-surface">
            {matches.map((m) => (
              <li key={m.ticker} className="border-b border-line last:border-b-0">
                <Link
                  to="/study/$ticker"
                  params={{ ticker: m.ticker }}
                  onClick={() => setMatches([])}
                  className="flex min-h-11 items-center gap-3 px-3 text-sm"
                >
                  <span className="font-semibold text-ink">{m.ticker}</span>
                  {m.name && <span className="truncate text-ink3">{m.name}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
