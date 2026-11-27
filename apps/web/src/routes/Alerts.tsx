import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Info } from '../components/Info';
import { Segmented, SkeletonCards, useWide } from '../components/Card';
import { Sheet } from '../components/Sheet';
import { AutoGrid, Num, PageTitle, Pill } from '../components/ui/kit';
import { AlertDetail } from '../components/alerts/AlertDetail';
import { Scorecard } from '../components/alerts/Scorecard';
import { Scenarios } from '../components/alerts/Scenarios';
import {
  DECISION_TEXT,
  PRIORITY_TONE,
  kindLabel,
  priorityLabel,
  whenList,
} from '../components/alerts/parts';
import { loadAlerts, type StoredAlertRow } from '../lib/alerts';
import { t } from '../strings';

const a = t.alerts;

type Tab = 'sent' | 'held' | 'all';
const TABS: Tab[] = ['sent', 'held', 'all'];
const inTab = (row: StoredAlertRow, tab: Tab) =>
  tab === 'all' ||
  (tab === 'sent'
    ? ['push', 'digest'].includes(row.decision)
    : !['push', 'digest'].includes(row.decision));

/** One alert in the list (design): priority and time, ticker and kind, the one-line headline, the decision. */
function AlertRow({
  row,
  selected,
  onOpen,
}: {
  row: StoredAlertRow;
  selected: boolean;
  onOpen: () => void;
}) {
  const headline = row.card[0]?.lines[0] ?? '';
  return (
    <li id={`alert-${row.id}`} className="scroll-mt-24">
      <button
        type="button"
        aria-current={selected ? 'true' : undefined}
        onClick={onOpen}
        className={`flex w-full flex-col gap-1.5 rounded-xl border bg-surface p-3.5 text-start text-ink ${
          selected ? 'border-ink' : 'border-line hover:border-line-strong'
        }`}
      >
        <span className="flex w-full items-center justify-between gap-2">
          <Pill tone={PRIORITY_TONE[row.priority] ?? 'neutral'} className="font-semibold">
            {priorityLabel(row.priority)}
          </Pill>
          <Num className="text-xs whitespace-nowrap text-ink3">{whenList(row.createdAt)}</Num>
        </span>
        <span className="flex items-baseline gap-2">
          {row.ticker && <span className="text-[15px] font-semibold">{row.ticker}</span>}
          <span className="text-xs text-ink3">{kindLabel(row.kind)}</span>
        </span>
        {headline && <span className="text-sm font-medium">{headline}</span>}
        <span className={`text-xs font-semibold ${DECISION_TEXT[row.decision] ?? 'text-ink2'}`}>
          {a.decisionShort[row.decision] ?? row.decision}
        </span>
      </button>
    </li>
  );
}

export function Alerts() {
  const q = useQuery({ queryKey: ['alerts', true], queryFn: () => loadAlerts(true) });
  const wide = useWide();
  const [tab, setTab] = useState<Tab>('sent');
  const [picked, setPicked] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const rows = q.data ?? [];
  const shown = rows.filter((r) => inTab(r, tab));

  // A push or email opens /alerts#alert-<id>: show that alert, in a tab that holds it.
  const hashId = typeof window === 'undefined' ? '' : window.location.hash.replace(/^#alert-/, '');
  const [hashDone, setHashDone] = useState(false);
  if (!hashDone && q.data) {
    setHashDone(true);
    const hit = q.data.find((r) => r.id === hashId);
    if (hit) {
      if (!inTab(hit, tab)) setTab('all');
      setPicked(hit.id);
      if (!wide) setSheetOpen(true);
    }
  }
  const selected =
    rows.find((r) => r.id === picked && inTab(r, tab)) ?? (wide ? shown[0] : undefined);

  const tabs = q.data && q.data.length > 0 && (
    <Segmented
      label={a.tabsLabel}
      options={TABS.map((k) => ({
        key: k,
        label: a.tabCount(a.tabs[k] ?? k, rows.filter((r) => inTab(r, k)).length),
      }))}
      value={tab}
      onChange={(k) => {
        setTab(k);
        setPicked(null);
      }}
      stretch={!wide}
    />
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <PageTitle page="alerts" aside={wide ? tabs : undefined} />
        <Info>{a.intro}</Info>
      </div>
      {q.isPending && <SkeletonCards />}
      {q.isError && (
        <p role="alert" className="text-down">
          {q.error.message}
        </p>
      )}
      {q.data &&
        (q.data.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-line p-5">
            <p className="text-ink2">{a.none}</p>
            <Link
              to="/lab"
              className="flex min-h-11 items-center rounded-lg border border-line-strong px-4 font-semibold text-ink"
            >
              {a.openLab}
            </Link>
          </div>
        ) : (
          <>
            {!wide && tabs}
            <div className="grid grid-cols-1 items-start gap-5 tablet:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
              {shown.length === 0 ? (
                <p className="text-sm text-ink3">{a.noneHere}</p>
              ) : (
                <ul aria-label={a.listLabel} className="flex flex-col gap-2.5">
                  {shown.map((row) => (
                    <AlertRow
                      key={row.id}
                      row={row}
                      selected={wide && selected?.id === row.id}
                      onOpen={() => {
                        setPicked(row.id);
                        if (!wide) setSheetOpen(true);
                      }}
                    />
                  ))}
                </ul>
              )}
              {wide &&
                (selected ? (
                  <AlertDetail row={selected} />
                ) : (
                  <p className="text-sm text-ink3">{a.choose}</p>
                ))}
            </div>
            {!wide && (
              <Sheet
                open={sheetOpen && !!selected}
                onClose={() => setSheetOpen(false)}
                title={selected?.card[0]?.heading ?? a.title}
              >
                {selected && <AlertDetail row={selected} inSheet />}
              </Sheet>
            )}
          </>
        ))}
      <AutoGrid min={380} gap="gap-5" className="items-start">
        <Scorecard />
        <Scenarios />
      </AutoGrid>
    </div>
  );
}
