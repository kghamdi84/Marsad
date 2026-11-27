import { useMemo, useState, type FormEvent } from 'react';
import { Info } from '../components/Info';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import {
  CORE_ETFS,
  STARTING_STOCKS,
  normalizeTicker,
  tickerSummary,
  toFixedHalfUp,
  etDate,
  type DailyBar,
  type ShariahSettings,
} from '@marsad/core';
import { Card, Sparkline } from '../components/Card';
import { loadPreferences } from '../lib/settings';
import { shariahAsOf } from '../lib/shariah';
import { loadFacts } from '../lib/studyPanels';
import { supabase } from '../lib/supabase';
import { loadCalendar, loadRecentBars } from '../lib/watch';
import { t } from '../strings';

const s = t.study;

async function loadCiks(tickers: readonly string[]): Promise<Record<string, string>> {
  if (!supabase) throw new Error('not configured');
  const r = await supabase
    .from('instruments')
    .select('ticker, cik')
    .in('ticker', [...tickers]);
  if (r.error) throw new Error(r.error.message);
  const out: Record<string, string> = {};
  for (const x of (r.data ?? []) as { ticker: string; cik: string | null }[])
    if (x.cik) out[x.ticker] = x.cik;
  return out;
}

const CHIP: Record<string, string> = {
  'passes-ratios': 'bg-up/15 text-up',
  'fails-ratios': 'border border-down/60 text-down',
  unknown: 'bg-muted/15 text-muted',
};

/** The Shariah screening aid for one listed company (only when the aid is switched on in Status). */
function ShariahChip({
  cik,
  bars,
  settings,
}: {
  cik: string;
  bars: readonly DailyBar[];
  settings: ShariahSettings;
}) {
  const q = useQuery({ queryKey: ['facts', cik], queryFn: () => loadFacts(cik) });
  const verdict = q.data
    ? (shariahAsOf(q.data, bars, settings, etDate(new Date()))?.verdict ?? 'unknown')
    : null;
  if (verdict === null) return null;
  const label = s.ui.shariahChip[verdict] ?? verdict;
  return (
    <span
      className={`w-fit rounded-full px-2 py-px text-[0.6875rem] font-semibold ${CHIP[verdict] ?? CHIP['unknown']}`}
    >
      <span className="sr-only">{s.ui.shariahPrefix} </span>
      {label}
    </span>
  );
}
const ALL = [...STARTING_STOCKS, ...CORE_ETFS];

function Row({
  tk,
  bars,
  earnings,
  shariah,
}: {
  tk: string;
  bars: readonly DailyBar[];
  earnings: string | null;
  shariah: React.ReactNode;
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
    <li>
      <Link
        to="/study/$ticker"
        params={{ ticker: tk }}
        className="grid min-h-[60px] grid-cols-[minmax(0,1fr)_64px_auto] items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 hover:bg-raised/60"
      >
        <span className="flex min-w-0 flex-col">
          <span className="text-base font-bold text-ink">{tk}</span>
          {earnings && (
            <span className="truncate text-xs text-muted">{s.earningsAround(earnings)}</span>
          )}
          {shariah}
        </span>
        <Sparkline values={line} className={tone} />
        <span className="flex flex-col items-end gap-0.5 tabular-nums">
          <span className="text-ink">{sum ? toFixedHalfUp(sum.close, 2) : t.regime.noData}</span>
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
  const prefs = useQuery({ queryKey: ['preferences'], queryFn: loadPreferences });
  const sh = prefs.data?.shariah.enabled ? prefs.data.shariah : null;
  const ciks = useQuery({
    queryKey: ['ciks', STARTING_STOCKS],
    queryFn: () => loadCiks(STARTING_STOCKS),
    enabled: sh !== null,
  });
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
      <Card id={id} title={title} className="gap-3!">
        <ul className="grid grid-cols-1 gap-3 tablet:grid-cols-2 wide:grid-cols-4">
          {tickers.map((tk) => (
            <Row
              key={tk}
              tk={tk}
              bars={bars.data?.[tk] ?? []}
              earnings={earnings[tk] ?? null}
              shariah={
                sh && ciks.data?.[tk] ? (
                  <ShariahChip cik={ciks.data[tk]} bars={bars.data?.[tk] ?? []} settings={sh} />
                ) : null
              }
            />
          ))}
        </ul>
      </Card>
    );

  return (
    <div className="mx-auto flex max-w-[1248px] flex-col gap-4">
      <h1 className="sr-only text-[28px] font-bold text-ink tablet:not-sr-only">{s.title}</h1>
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
            className="min-h-12 rounded-xl bg-accent px-5 font-bold text-accent-ink hover:bg-fg"
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
      <Info>{s.intro}</Info>
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
