import { useMemo, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import {
  CORE_ETFS,
  STARTING_STOCKS,
  normalizeTicker,
  tickerSummary,
  toFixedHalfUp,
  type DailyBar,
} from '@marsad/core';
import { Card, Sparkline } from '../components/Card';
import { loadCalendar, loadRecentBars } from '../lib/watch';
import { t } from '../strings';

const s = t.study;
const ALL = [...STARTING_STOCKS, ...CORE_ETFS];

function Row({
  tk,
  bars,
  earnings,
}: {
  tk: string;
  bars: readonly DailyBar[];
  earnings: string | null;
}) {
  const sum = tickerSummary(bars);
  const line = bars.map((b) => b.close);
  const first = line[0];
  const last = line.at(-1);
  const tone =
    first === undefined || last === undefined || last === first
      ? 'text-muted'
      : last > first
        ? 'text-up'
        : 'text-down';
  const ch = sum?.change1d ?? null;
  const p = ch === null ? null : toFixedHalfUp(ch * 100, 1);
  return (
    <li className="border-t border-line/60 first:border-0">
      <Link
        to="/study/$ticker"
        params={{ ticker: tk }}
        className="grid min-h-[60px] grid-cols-[minmax(0,1fr)_64px_auto] items-center gap-3 px-4 py-2 hover:bg-raised/40 tablet:grid-cols-[minmax(0,1fr)_120px_auto]"
      >
        <span className="flex min-w-0 flex-col">
          <span className="text-base font-bold text-white">{tk}</span>
          {earnings && (
            <span className="truncate text-xs text-muted">{s.earningsAround(earnings)}</span>
          )}
        </span>
        <Sparkline values={line} className={tone} />
        <span className="flex flex-col items-end gap-0.5 tabular-nums">
          <span className="text-white">{sum ? toFixedHalfUp(sum.close, 2) : t.regime.noData}</span>
          {p !== null && (
            <span
              className={`text-[0.8125rem] font-semibold ${Number(p) > 0 ? 'text-up' : Number(p) < 0 ? 'text-down' : 'text-muted'}`}
            >
              <span aria-hidden="true">{Number(p) > 0 ? '▲ ' : Number(p) < 0 ? '▼ ' : ''}</span>
              {Number(p) > 0 ? '+' : ''}
              {p}%
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

export function Study() {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const bars = useQuery({ queryKey: ['study-list-bars'], queryFn: () => loadRecentBars(ALL) });
  const cal = useQuery({ queryKey: ['calendar'], queryFn: loadCalendar });
  const earnings = useMemo(() => {
    const m: Record<string, string> = {};
    for (const e of cal.data?.earnings?.estimates ?? []) m[e.ticker] = e.date;
    return m;
  }, [cal.data]);
  const q = text.trim().toUpperCase();
  const match = (tk: string) => q === '' || tk.startsWith(q);
  const stocks = STARTING_STOCKS.filter(match);
  const etfs = CORE_ETFS.filter(match);

  function open(e: FormEvent) {
    e.preventDefault();
    const ticker = normalizeTicker(text);
    if (!ticker) return setError(s.badTicker(text));
    setError(null);
    void navigate({ to: '/study/$ticker', params: { ticker } });
  }

  const list = (title: string, id: string, tickers: readonly string[]) =>
    tickers.length > 0 && (
      <Card id={id} title={title} className="gap-2! pb-2!">
        <ul className="-mx-4 flex flex-col tablet:-mx-5">
          {tickers.map((tk) => (
            <Row key={tk} tk={tk} bars={bars.data?.[tk] ?? []} earnings={earnings[tk] ?? null} />
          ))}
        </ul>
      </Card>
    );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="sr-only text-[28px] font-bold text-white tablet:not-sr-only">{s.title}</h1>
      <form onSubmit={open} role="search" className="flex flex-col gap-1.5">
        <label htmlFor="ticker" className="text-sm text-muted">
          {s.openLabel}
        </label>
        <div className="flex gap-2">
          <span className="relative flex-1">
            <Search
              aria-hidden="true"
              size={18}
              className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              id="ticker"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setError(null);
              }}
              placeholder={s.search}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className="min-h-12 w-full rounded-xl border border-line bg-surface ps-10 pe-3 text-lg text-fg uppercase placeholder:text-base placeholder:text-muted placeholder:normal-case"
            />
          </span>
          <button
            type="submit"
            className="min-h-12 rounded-xl bg-white px-5 font-bold text-raised hover:bg-fg"
          >
            {s.open}
          </button>
        </div>
      </form>
      {error && (
        <p role="alert" className="text-down">
          {error}
        </p>
      )}
      <p className="text-xs text-muted">{s.intro}</p>
      {bars.isError && (
        <p role="alert" className="text-down">
          {bars.error.message}
        </p>
      )}
      {list(s.stocks, 'stocks-h', stocks)}
      {list(s.etfs, 'etfs-h', etfs)}
      {stocks.length === 0 && etfs.length === 0 && (
        <p className="text-sm text-muted">{s.noMatch(text.trim())}</p>
      )}
    </div>
  );
}
