import type { ReactNode } from 'react';
import { Info } from '../components/Info';
import { PageTitle } from '../components/ui/kit';
import { Sizer } from '../components/journal/Sizer';
import { Trades } from '../components/journal/Trades';
import { WeeklyReview } from '../components/journal/WeeklyReview';
import { useView } from '../lib/view';
import { t } from '../strings';

const j = t.journal;

/** What Khaled did (ADR 0048); the holdings and portfolio views moved to the Portfolio page. */
export const JOURNAL_VIEWS = ['trades', 'sizer', 'review'] as const;
const TABS = JOURNAL_VIEWS;
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

function Section({ tab }: { tab: JournalTab }) {
  if (tab === 'sizer') return <Sizer />;
  if (tab === 'review') return <WeeklyReview />;
  return <Trades />;
}

/**
 * Journal (ADR 0048): what Khaled did. Trades with their adherence, the sizer with the checklist and the manual
 * Sahm ticket, and the weekly review, one at a time; the view is in the URL (`?view=`).
 */
export function Journal() {
  const [tab, setTab] = useView<JournalTab>('marsad.journal.tab', TABS, 'trades');
  return (
    <div className="flex flex-col gap-5">
      <PageTitle page="journal" aside={<Info>{j.intro}</Info>} />
      <SectionTabs value={tab} onChange={setTab}>
        <Section tab={tab} />
      </SectionTabs>
    </div>
  );
}
