import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { exitSignals, exposureReport, portfolioTotals, toFixedHalfUp } from '@marsad/core';
import { Info } from '../components/Info';
import { ErrorText } from '../components/ui';
import { PageTitle } from '../components/ui/kit';
import { SkeletonCards, useRemembered } from '../components/Card';
import { EtfLookThrough } from '../components/journal/EtfLookThrough';
import { Exposure } from '../components/journal/Exposure';
import { OptionPositions } from '../components/journal/OptionPositions';
import { Positions } from '../components/journal/Positions';
import { Sizer } from '../components/journal/Sizer';
import { Trades } from '../components/journal/Trades';
import { WeeklyReview } from '../components/journal/WeeklyReview';
import {
  StatTile,
  newestClose,
  positionsOf,
  signedPct1,
  signedUsd,
  usd0,
} from '../components/journal/shared';
import { loadHoldings } from '../lib/journal';
import { dayMonth } from '../lib/dates';
import { t } from '../strings';

const j = t.journal;

/** The four numbers to read first: value, open gain, beta to SPY and what needs a look (design KPI tiles). */
function Kpis() {
  const q = useQuery({ queryKey: ['holdings'], queryFn: loadHoldings });
  const ui = j.ui;
  if (q.isPending) return <SkeletonCards heights={['5.5rem']} />;
  if (!q.data || q.data.holdings.length === 0) return null;
  const { holdings, bars, vix } = q.data;
  const last = (tk: string) => bars[tk]?.at(-1)?.close ?? null;
  const tot = portfolioTotals(holdings, last);
  const positions = positionsOf(holdings, bars, vix);
  const r = positions.length > 0 ? exposureReport(positions) : null;
  const newest = newestClose(holdings, bars);
  const attention = holdings.flatMap((h) => {
    const hasRules = h.stop !== null || h.targets.length > 0 || h.trendBreak || h.timeStopSessions;
    if (!hasRules) return [`${h.ticker} ${ui.attentionKinds['rules'] ?? ''}`];
    return exitSignals(h, bars[h.ticker] ?? []).map(
      (e) => `${h.ticker} ${ui.attentionKinds[e.kind] ?? e.kind}`,
    );
  });
  const flagged = new Set(attention.map((a) => a.split(' ')[0])).size;
  const cost = tot.value - tot.gainUsd;
  return (
    <section
      aria-label={ui.kpis}
      className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,150px),1fr))] gap-2.5"
    >
      <StatTile
        label={ui.value}
        value={`$${usd0(tot.value)}`}
        sub={
          tot.unpriced.length > 0
            ? ui.unpriced(tot.unpriced.length)
            : ui.valueSub(holdings.length, newest ? dayMonth(newest) : '')
        }
      />
      <StatTile
        label={ui.gain}
        value={signedUsd(tot.gainUsd)}
        sub={
          tot.gainPct === null ? undefined : ui.gainSub(signedPct1(tot.gainPct), `$${usd0(cost)}`)
        }
        tone={tot.gainUsd >= 0 ? 'text-up' : 'text-down'}
      />
      <StatTile
        label={ui.beta}
        value={r ? toFixedHalfUp(r.portfolioBeta, 2) : t.regime.noData}
        sub={r ? ui.betaSub(Math.round((r.portfolioBeta - 1) * 100)) : ui.betaNone}
        tone={r ? 'text-ink' : 'text-ink3'}
      />
      <StatTile
        label={ui.attention}
        value={String(flagged)}
        sub={attention.length ? attention.slice(0, 3).join(' · ') : ui.noneAttention}
        tone={flagged > 0 ? 'text-down' : 'text-ink'}
      />
    </section>
  );
}

const TABS = ['positions', 'sizer', 'options', 'exposure', 'trades'] as const;
type JournalTab = (typeof TABS)[number];

/**
 * The design's section buttons: bordered, wrapping onto a second row on phones, the chosen one filled. Built as
 * tabs (arrow keys move between them) so assistive technology announces one panel at a time.
 */
function SectionTabs({
  value,
  onChange,
  children,
}: {
  value: JournalTab;
  onChange: (k: JournalTab) => void;
  children: ReactNode;
}) {
  const move = (dir: number) => {
    const next = TABS[(TABS.indexOf(value) + dir + TABS.length) % TABS.length] ?? value;
    onChange(next);
    document.getElementById(`journal-tab-${next}`)?.focus();
  };
  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label={j.ui.tabsLabel}
        className="flex flex-wrap gap-1.5"
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') move(1);
          if (e.key === 'ArrowLeft') move(-1);
        }}
      >
        {TABS.map((k) => (
          <button
            key={k}
            id={`journal-tab-${k}`}
            type="button"
            role="tab"
            aria-selected={k === value}
            aria-controls={`journal-panel-${k}`}
            tabIndex={k === value ? 0 : -1}
            onClick={() => onChange(k)}
            className={`min-h-10 rounded-lg border border-line px-3.5 text-[13px] font-semibold whitespace-nowrap pointer-coarse:min-h-11 ${
              k === value ? 'bg-accent text-accent-ink' : 'text-ink3 hover:text-ink'
            }`}
          >
            {j.ui.tabs[k] ?? k}
          </button>
        ))}
      </div>
      <div
        id={`journal-panel-${value}`}
        role="tabpanel"
        aria-labelledby={`journal-tab-${value}`}
        className="flex flex-col gap-4"
      >
        {children}
      </div>
    </div>
  );
}

/** Exposure and the ETF look-through side by side (auto-fit, min 380 px), as the design pairs them. */
function ExposurePanel() {
  const q = useQuery({ queryKey: ['holdings'], queryFn: loadHoldings });
  if (q.isError) return <ErrorText message={q.error.message} />;
  if (!q.data) return <SkeletonCards heights={['16rem']} />;
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,380px),1fr))] items-start gap-4">
      <Exposure holdings={q.data.holdings} bars={q.data.bars} vix={q.data.vix} />
      <EtfLookThrough holdings={q.data.holdings} bars={q.data.bars} />
    </div>
  );
}

function Section({ tab, onTrade }: { tab: JournalTab; onTrade: () => void }) {
  if (tab === 'positions') return <Positions onTrade={onTrade} />;
  if (tab === 'sizer') return <Sizer />;
  if (tab === 'options') return <OptionPositions />;
  if (tab === 'exposure') return <ExposurePanel />;
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,380px),1fr))] items-start gap-4">
      <Trades />
      <WeeklyReview />
    </div>
  );
}

export function Journal() {
  const [tab, setTab] = useRemembered<JournalTab>('marsad.journal.tab', TABS, 'positions');
  return (
    <div className="flex flex-col gap-5">
      <PageTitle page="journal" aside={<Info>{j.intro}</Info>} />
      <Kpis />
      <SectionTabs value={tab} onChange={setTab}>
        <Section tab={tab} onTrade={() => setTab('sizer')} />
      </SectionTabs>
    </div>
  );
}
