import { lazy, Suspense, useMemo, useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import {
  DEFAULT_LOCAL_ZONE,
  buildEventMarkers,
  describeEightK,
  disclosureLag,
  dualClock,
  etDate,
  formLabel,
  mergeFilingEvents,
  normalizeTicker,
  summarizeBars,
  type BarSummary,
  type Materiality,
} from '@marsad/core';
import type { ChartToggles } from '../components/PriceChart';
import { Dividends } from '../components/study/Dividends';
import { Earnings } from '../components/study/Earnings';
import { Financials } from '../components/study/Financials';
import { Insiders } from '../components/study/Insiders';
import { NewsPanel } from '../components/study/NewsPanel';
import { Business } from '../components/study/Business';
import { Holders13F } from '../components/study/Holders13F';
import { QuarterlyRiskFactors } from '../components/study/QuarterlyRiskFactors';
import { RiskFactors } from '../components/study/RiskFactors';
import { ShortData } from '../components/study/ShortData';
import { filingEvents, loadStudy, secUrl, type FilingRow, type StudyData } from '../lib/study';
import {
  loadChartEvents,
  loadDividends,
  loadEarningsFilings,
  loadInsiders,
} from '../lib/studyPanels';
import { ThesisCard } from '../components/study/ThesisCard';
import { t } from '../strings';

const PriceChart = lazy(() => import('../components/PriceChart'));

const th = 'border-b border-line px-2 py-2 text-start font-medium text-muted';
const td = 'border-b border-line px-2 py-2 align-top';
const money = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Summary({ data, s }: { data: StudyData; s: BarSummary }) {
  const staleLine =
    data.lastCompletedDay && s.asOf < data.lastCompletedDay
      ? t.study.stale(s.asOf, data.lastCompletedDay)
      : t.study.current;
  const change = s.changePct;
  const arrow = change === null ? '' : change > 0 ? '▲' : change < 0 ? '▼' : '';
  return (
    <section aria-labelledby="summary" className="flex flex-col gap-2">
      <h2 id="summary" className="font-semibold">
        {t.study.summary}
      </h2>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-muted">{t.study.lastClose}</dt>
          <dd className="text-lg font-medium">${money(s.lastClose)}</dd>
        </div>
        <div>
          <dt className="text-muted">{t.study.change}</dt>
          <dd
            className={`text-lg font-medium ${change !== null && change < 0 ? 'text-down' : 'text-up'}`}
          >
            {change === null
              ? t.study.unavailable
              : `${arrow} ${change > 0 ? '+' : ''}${change.toFixed(2)}%`}
          </dd>
        </div>
        <div>
          <dt className="text-muted">{t.study.range(s.rangeSessions)}</dt>
          <dd className="text-lg font-medium">
            ${money(s.low52w)} to ${money(s.high52w)}
          </dd>
        </div>
        <div>
          <dt className="text-muted">{t.study.trend}</dt>
          <dd>{t.study.trendLabels[s.trend]}</dd>
        </div>
        <div>
          <dt className="text-muted">{t.study.rsi}</dt>
          <dd>{s.rsi14 === null ? t.study.unavailable : s.rsi14.toFixed(1)}</dd>
        </div>
        <div>
          <dt className="text-muted">{t.study.sma50}</dt>
          <dd>{s.sma50 === null ? t.study.unavailable : `$${money(s.sma50)}`}</dd>
        </div>
        <div>
          <dt className="text-muted">{t.study.sma200}</dt>
          <dd>{s.sma200 === null ? t.study.unavailable : `$${money(s.sma200)}`}</dd>
        </div>
      </dl>
      <p
        className={staleLine === t.study.current ? 'text-sm text-muted' : 'text-sm text-down'}
        role="status"
      >
        {staleLine}
      </p>
      <p className="text-sm text-muted">
        {t.study.provenance(s.asOf, s.sessions, s.formulaVersion)}
      </p>
    </section>
  );
}

function Materiality({ level, defaulted }: { level: Materiality | 'unknown'; defaulted: boolean }) {
  return (
    <span
      className="whitespace-nowrap rounded-sm border border-line px-1.5 py-0.5 text-xs"
      title={defaulted ? t.study.marsadDefault : undefined}
    >
      {t.study.materiality[level]}
    </span>
  );
}

function FilingWhat({ f }: { f: FilingRow }) {
  if (f.form === '8-K' || f.form === '8-K/A') {
    const d = describeEightK(f.items);
    return (
      <div className="flex flex-col gap-1">
        <Materiality
          level={d.materiality}
          defaulted={d.items.some((i) => i.basis === 'marsad-default')}
        />
        <ul className="list-none">
          {d.items.map((i) => (
            <li key={i.item} title={i.officialTitle}>
              Item {i.item}: {i.plain}
            </li>
          ))}
          {d.unknown.map((n) => (
            <li key={n}>Item {n}: not in the table</li>
          ))}
        </ul>
      </div>
    );
  }
  return <span>{formLabel(f.form)}</span>;
}

function FilingsTable({ data }: { data: StudyData }) {
  if (data.filings.length === 0) return <p className="text-muted">{t.study.noFilings}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className={th}>{t.study.colWhen}</th>
            <th className={th}>{t.study.colForm}</th>
            <th className={th}>{t.study.colWhat}</th>
            <th className={th}>{t.study.colLag}</th>
          </tr>
        </thead>
        <tbody>
          {data.filings.slice(0, 60).map((f) => {
            const lag = disclosureLag(f.form);
            const link = data.company ? secUrl(data.company.cik, f) : null;
            const when = f.acceptedAt
              ? `${etDate(new Date(f.acceptedAt))} ${dualClock(new Date(f.acceptedAt), DEFAULT_LOCAL_ZONE).label}`
              : f.filingDate;
            return (
              <tr key={f.accession}>
                <td className={td}>{when}</td>
                <td className={td}>
                  {link ? (
                    <a
                      className="inline-flex min-h-11 items-center underline underline-offset-4"
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {f.form} <span className="sr-only">{t.study.viewOnSec}</span>
                    </a>
                  ) : (
                    f.form
                  )}
                </td>
                <td className={td}>
                  <FilingWhat f={f} />
                </td>
                <td className={`${td} text-muted`}>{lag?.label ?? ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const defaultToggles: ChartToggles = {
  sma50: true,
  sma200: true,
  ema20: false,
  rsi: false,
  volume: true,
};

export function StudyCompany() {
  const { ticker: raw } = useParams({ from: '/study/$ticker' });
  const ticker = normalizeTicker(raw);
  const [toggles, setToggles] = useState<ChartToggles>(defaultToggles);
  const q = useQuery({
    queryKey: ['study', ticker],
    queryFn: () => loadStudy(ticker as string),
    enabled: ticker !== null,
  });
  const summary = useMemo(() => (q.data ? summarizeBars(q.data.bars) : null), [q.data]);
  // Dividends load on their own: if they fail the chart still shows, just without their markers.
  const dividends = useQuery({
    queryKey: ['dividends', ticker],
    queryFn: () => loadDividends(ticker as string),
    enabled: ticker !== null,
  });
  // The page's filings list keeps the newest 200 rows; results 8-Ks are asked for on their own so older earnings
  // still get their marker. Shares its cache entry with the Earnings panel.
  const cik = q.data?.company?.cik;
  const results = useQuery({
    queryKey: ['earnings-filings', cik],
    queryFn: () => loadEarningsFilings(cik as string),
    enabled: cik !== undefined,
  });
  // Halts, Marsad's alerts and insider purchases mark the chart too; each loads on its own, and the insiders query
  // shares its cache with the Insiders panel.
  const events = useQuery({
    queryKey: ['chart-events', ticker],
    queryFn: () => loadChartEvents(ticker as string),
    enabled: ticker !== null,
  });
  const insiders = useQuery({
    queryKey: ['insiders', cik],
    queryFn: () => loadInsiders(cik as string),
    enabled: cik !== undefined,
  });
  const markers = useMemo(
    () =>
      q.data
        ? buildEventMarkers(
            mergeFilingEvents(filingEvents(q.data.filings), filingEvents(results.data ?? [])),
            q.data.splits,
            q.data.bars.map((b) => b.date),
            dividends.data ?? [],
            {
              // Open-market purchases only (code P), original filings, placed when they became public.
              insiderBuys: (insiders.data?.rows ?? []).flatMap((r) =>
                r.code === 'P' &&
                !r.isAmendment &&
                r.table === 'non-derivative' &&
                r.acquiredDisposed === 'A' &&
                r.filedAt
                  ? [
                      {
                        filedAt: r.filedAt,
                        owner: r.ownerName,
                        valueUsd: r.valueUsd,
                        plan10b5: r.plan10b5,
                      },
                    ]
                  : [],
              ),
              halts: events.data?.halts ?? [],
              alerts: events.data?.alerts ?? [],
            },
          )
        : [],
    [q.data, dividends.data, results.data, insiders.data, events.data],
  );

  if (ticker === null)
    return (
      <p role="alert" className="text-down">
        {t.study.badTicker(raw)}
      </p>
    );

  const toggle = (k: keyof ChartToggles, label: string) => (
    <label key={k} className="flex min-h-11 items-center gap-2">
      <input
        type="checkbox"
        className="size-5"
        checked={toggles[k]}
        onChange={(e) => setToggles({ ...toggles, [k]: e.target.checked })}
      />
      {label}
    </label>
  );

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <Link
          to="/study"
          className="inline-flex min-h-11 items-center text-sm text-muted underline underline-offset-4"
        >
          {t.study.back}
        </Link>
        <h1 className="text-xl font-semibold">
          {ticker}
          {q.data?.company?.name ? (
            <span className="ms-2 font-normal text-muted">{q.data.company.name}</span>
          ) : null}
        </h1>
      </div>

      {q.isPending && <p className="text-muted">{t.loading}</p>}
      {q.isError && (
        <p role="alert" className="text-down">
          {q.error.message}
        </p>
      )}

      {q.data && !q.data.company && <p className="text-sm text-muted">{t.study.noCompany}</p>}
      {q.data && q.data.bars.length === 0 && <p className="text-muted">{t.study.noBars}</p>}

      {q.data && summary && (
        <>
          <Summary data={q.data} s={summary} />
          <section aria-labelledby="chart" className="flex flex-col gap-2">
            <h2 id="chart" className="font-semibold">
              {t.study.chart}
            </h2>
            <fieldset className="flex flex-wrap gap-x-4">
              <legend className="text-sm text-muted">{t.study.indicators}</legend>
              {toggle('sma50', t.study.sma50)}
              {toggle('sma200', t.study.sma200)}
              {toggle('ema20', t.study.ema20)}
              {toggle('rsi', t.study.rsi)}
              {toggle('volume', t.study.volume)}
            </fieldset>
            <div
              role="figure"
              aria-label={t.study.chartLabel(ticker, summary.asOf)}
              className="rounded-sm border border-line"
            >
              <Suspense fallback={<p className="p-4 text-muted">{t.loading}</p>}>
                <PriceChart bars={q.data.bars} markers={markers} toggles={toggles} />
              </Suspense>
            </div>
            <h3 className="text-sm text-muted">{t.study.markers}</h3>
            <p className="text-sm text-muted">{t.study.markersNote}</p>
            {markers.length === 0 ? (
              <p className="text-sm text-muted">{t.study.noMarkers}</p>
            ) : (
              <ul className="text-sm">
                {markers.map((m) => (
                  <li key={`${m.date}-${m.label}`}>
                    {m.date}: {m.label}
                    {m.materiality ? ` (${t.study.materiality[m.materiality]})` : ''}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {q.data && (
        <section aria-labelledby="filings" className="flex flex-col gap-2">
          <h2 id="filings" className="font-semibold">
            {t.study.filings}
          </h2>
          <p className="text-sm text-muted">{t.study.filingsNote}</p>
          <FilingsTable data={q.data} />
        </section>
      )}

      {q.data && <ThesisCard ticker={q.data.ticker} />}
      {q.data?.company && <Financials cik={q.data.company.cik} bars={q.data.bars} />}
      {q.data?.company && <Business cik={q.data.company.cik} />}
      {q.data?.company && <RiskFactors cik={q.data.company.cik} />}
      {q.data?.company && <QuarterlyRiskFactors cik={q.data.company.cik} />}
      {q.data?.company && <Holders13F ticker={q.data.ticker} />}
      {q.data?.company && (
        <Earnings cik={q.data.company.cik} bars={q.data.bars} splits={q.data.splits} />
      )}
      {q.data?.company && <Insiders cik={q.data.company.cik} />}
      {q.data && <ShortData ticker={q.data.ticker} />}
      {q.data && <NewsPanel ticker={q.data.ticker} />}
      {q.data && <Dividends rows={dividends.data ?? []} />}

      {q.data && (
        <section aria-labelledby="more" className="flex flex-col gap-2">
          <h2 id="more" className="font-semibold">
            {t.study.placeholdersTitle}
          </h2>
          <ul className="flex flex-col gap-2">
            {t.study.placeholders.map((p) => (
              <li key={p.name} className="rounded-sm border border-line p-3">
                <p className="font-medium">{p.name}</p>
                <p className="text-sm">
                  <span className="font-medium">{p.state}.</span>{' '}
                  <span className="text-muted">{p.why}</span>
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
