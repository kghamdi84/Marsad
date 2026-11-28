import { useMemo, useState } from 'react';
import { Info } from '../components/Info';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  CORE_ETFS,
  STARTING_STOCKS,
  tickerSummary,
  toFixedHalfUp,
  etDate,
  type DailyBar,
  type ShariahSettings,
} from '@marsad/core';
import { Card } from '../components/Card';
import { CompanySearch } from '../components/study/CompanySearch';
import { AutoGrid, Num, PageTitle, Pill, Spark, signedPct, type Tone } from '../components/ui/kit';
import { loadPreferences } from '../lib/settings';
import { shariahAsOf } from '../lib/shariah';
import { loadFacts } from '../lib/studyPanels';
import { supabase } from '../lib/supabase';
import { loadCalendar, loadRecentBars } from '../lib/watch';
import { readRecent } from '../lib/recent';
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

const CHIP: Record<string, Tone> = {
  'passes-ratios': 'up',
  'fails-ratios': 'down',
  unknown: 'neutral',
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
    <Pill tone={CHIP[verdict] ?? 'neutral'} className="w-fit">
      <span className="sr-only">{s.ui.shariahPrefix} </span>
      {label}
    </Pill>
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
  const ch = sum?.change1d ?? null;
  const p = ch === null ? null : Number(toFixedHalfUp(ch * 100, 1));
  return (
    <li>
      <Link
        to="/study/$ticker"
        params={{ ticker: tk }}
        className="grid min-h-[60px] grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-[10px] border border-line bg-elev px-3.5 py-3 hover:border-line-strong"
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[15px] font-semibold text-ink">{tk}</span>
          {earnings && (
            <span className="truncate text-xs text-ink3">{s.earningsAround(earnings)}</span>
          )}
          {shariah}
        </span>
        <Spark values={line} />
        <span className="flex flex-col items-end gap-0.5">
          <span className="text-sm font-semibold text-ink">
            <Num>{sum ? toFixedHalfUp(sum.close, 2) : t.regime.noData}</Num>
          </span>
          {p !== null && (
            <span
              className={`text-xs font-semibold ${p > 0 ? 'text-up' : p < 0 ? 'text-down' : 'text-ink3'}`}
            >
              <Num>{p === 0 ? '0.0%' : signedPct(p, 1)}</Num>
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

/** The last 8 companies opened on this device, newest first; nothing shows until one has been opened. */
function RecentlyViewed() {
  const [recent] = useState(readRecent);
  if (recent.length === 0) return null;
  return (
    <Card id="recent-h" title={s.recent.title} aside={<Info>{s.recent.note}</Info>}>
      <ul className="flex flex-wrap gap-2">
        {recent.map((tk) => (
          <li key={tk}>
            <Link
              to="/study/$ticker"
              params={{ ticker: tk }}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line bg-elev px-3 text-[15px] font-semibold text-ink hover:border-line-strong"
            >
              {tk}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function Study() {
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
  const list = (title: string, id: string, tickers: readonly string[]) =>
    tickers.length > 0 && (
      <Card id={id} title={title}>
        <ul
          className="grid gap-2.5"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 210px), 1fr))' }}
        >
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
    <div className="flex flex-col gap-5">
      <PageTitle page="study" />
      <RecentlyViewed />
      <AutoGrid min={320} gap="gap-3" className="items-start">
        <CompanySearch id="ticker" label={s.openLabel} showLabel button />
        <Info>{s.intro}</Info>
      </AutoGrid>
      {bars.isError && (
        <p role="alert" className="text-crit">
          {bars.error.message}
        </p>
      )}
      {list(s.stocks, 'stocks-h', STARTING_STOCKS)}
      {list(s.etfs, 'etfs-h', CORE_ETFS)}
    </div>
  );
}
