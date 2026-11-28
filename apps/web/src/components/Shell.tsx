import { QuickLookProvider } from './QuickLook';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import {
  Activity,
  Bell,
  BookOpen,
  ChartCandlestick,
  ChevronRight,
  Ellipsis,
  Eye,
  FlaskConical,
  Gauge,
  LogOut,
  RefreshCw,
  Settings as SettingsIcon,
  type LucideIcon,
} from 'lucide-react';
import {
  DEFAULT_LOCAL_ZONE,
  dualClock,
  etDate,
  nextRegularOpen,
  type MarketCalendar,
  type SessionInfo,
} from '@marsad/core';
import { loadPulse, viewPulse, type PulseView } from '../lib/pulse';
import { supabase } from '../lib/supabase';
import { t } from '../strings';
import { zoneName } from './Clock';
import { useDisplay, useShellText } from '../lib/display';
import { Sheet } from './Sheet';

const s = t.shell;

type NavKey =
  | 'watch'
  | 'study'
  | 'markets'
  | 'portfolio'
  | 'alerts'
  | 'journal'
  | 'lab'
  | 'status'
  | 'settings';

interface Tab {
  to:
    | '/'
    | '/study'
    | '/markets'
    | '/portfolio'
    | '/alerts'
    | '/journal'
    | '/lab'
    | '/status'
    | '/settings';
  nav: NavKey;
  icon: LucideIcon;
  key: string;
}

/** The five tabs of the phone tab bar, in order; the top bar adds Lab and Status. */
const tabs: Tab[] = [
  { to: '/', nav: 'watch', icon: Eye, key: '1' },
  { to: '/study', nav: 'study', icon: ChartCandlestick, key: '2' },
  { to: '/markets', nav: 'markets', icon: Gauge, key: '3' },
  { to: '/alerts', nav: 'alerts', icon: Bell, key: '4' },
  { to: '/journal', nav: 'journal', icon: BookOpen, key: '5' },
];
const moreTabs: Tab[] = [
  { to: '/lab', nav: 'lab', icon: FlaskConical, key: '6' },
  { to: '/status', nav: 'status', icon: Activity, key: 's' },
  { to: '/settings', nav: 'settings', icon: SettingsIcon, key: '' },
];

function useNumberShortcuts() {
  const navigate = useNavigate();
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)))
        return;
      const tab = [...tabs, ...moreTabs].find((x) => x.key && x.key === e.key);
      if (tab) void navigate({ to: tab.to });
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);
}

function useNow(ms = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

function sessionLabel(x: SessionInfo): string {
  const m = s.market;
  if (!x.calendarCovered) return m.uncovered;
  switch (x.state) {
    case 'regular':
      return x.earlyClose ? m.earlyClose : m.regular;
    case 'pre-market':
      return m.preMarket;
    case 'after-hours':
      return m.afterHours;
    case 'closed':
      return x.holidayName ? m.holiday(x.holidayName) : m.closed;
  }
}

interface Health {
  label: string;
  /** True when the label is a count of sources that need a look (shown as text on phones). */
  count?: boolean;
  /** Dot and text colour classes; the label always says the state in words. */
  dot: string;
  text: string;
}

function healthOf(v: PulseView | null, sources: number, failed: boolean): Health {
  if (failed || !v) return { label: s.healthUnknown, dot: 'bg-faint', text: 'text-muted' };
  if (sources === 0) return { label: s.noSources, dot: 'bg-faint', text: 'text-muted' };
  if (v.stale.length > 0)
    return { label: s.stale(v.stale.length), dot: 'bg-warn', text: 'text-warn', count: true };
  if (v.unchecked.length > 0)
    return {
      label: s.unchecked(v.unchecked.length),
      dot: 'bg-faint',
      text: 'text-muted',
      count: true,
    };
  return { label: s.fresh, dot: 'bg-up', text: 'text-fg' };
}

/** The market chip and the freshness dot: what the market is doing and whether the data can be trusted. */
function usePulse() {
  const q = useQuery({ queryKey: ['pulse'], queryFn: loadPulse, refetchInterval: 60_000 });
  const now = useNow();
  const view = q.data ? viewPulse(q.data, now) : null;
  const market = view ? sessionLabel(view.session) : s.market.unknown;
  const tone = !view?.session.calendarCovered
    ? 'bg-faint/15 text-muted'
    : view.session.state === 'regular'
      ? 'bg-up/15 text-up'
      : 'bg-warn/15 text-warn';
  const health = healthOf(view, q.data?.sources.length ?? 0, q.isError);
  return { q, now, view, market, tone, health };
}

type PullPhase = 'idle' | 'pulling' | 'armed' | 'refreshing' | 'done';
const PULL_ARM = 72;

/**
 * Pull to refresh on phones: a downward drag from the top of the page refetches every query on screen. Home
 * Screen apps have no browser reload, so this is the way to fetch fresh data there.
 */
function usePullToRefresh(onRefresh: () => Promise<unknown>) {
  const [phase, setPhase] = useState<PullPhase>('idle');
  const [doneAt, setDoneAt] = useState<Date | null>(null);
  const refresh = useRef(onRefresh);
  useEffect(() => {
    refresh.current = onRefresh;
  });
  useEffect(() => {
    let startY: number | null = null;
    let armed = false;
    let busy = false;
    let hide: ReturnType<typeof setTimeout> | undefined;
    const phone = () => window.matchMedia('(max-width: 759.98px)').matches;
    const onStart = (e: TouchEvent) => {
      const target = e.target as Element | null;
      if (busy || window.scrollY > 0 || e.touches.length !== 1 || !phone()) return;
      if (target?.closest('dialog')) return;
      startY = e.touches[0]?.clientY ?? null;
      armed = false;
    };
    const onMove = (e: TouchEvent) => {
      if (startY === null) return;
      const dy = (e.touches[0]?.clientY ?? startY) - startY;
      if (dy <= 8 || window.scrollY > 0) {
        setPhase('idle');
        armed = false;
        return;
      }
      armed = dy >= PULL_ARM;
      setPhase(armed ? 'armed' : 'pulling');
    };
    const onEnd = () => {
      if (startY === null) return;
      startY = null;
      if (!armed) {
        setPhase('idle');
        return;
      }
      armed = false;
      busy = true;
      setPhase('refreshing');
      void refresh.current().finally(() => {
        busy = false;
        setDoneAt(new Date());
        setPhase('done');
        clearTimeout(hide);
        hide = setTimeout(() => setPhase('idle'), 2500);
      });
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
    return () => {
      clearTimeout(hide);
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, []);
  const text =
    phase === 'pulling'
      ? s.pull.idle
      : phase === 'armed'
        ? s.pull.release
        : phase === 'refreshing'
          ? s.pull.refreshing
          : phase === 'done' && doneAt
            ? s.pull.updated(dualClock(doneAt, DEFAULT_LOCAL_ZONE).et)
            : '';
  return { phase, text };
}

function TopTab({ tab, label }: { tab: Tab; label: string }) {
  return (
    <Link
      to={tab.to}
      activeOptions={{ exact: tab.to === '/' }}
      className="flex min-h-10 items-center rounded-lg px-3 text-[13px] font-semibold whitespace-nowrap text-ink3 hover:text-ink"
      activeProps={{
        className: 'bg-accent text-accent-ink! hover:text-accent-ink!',
        'aria-current': 'page',
      }}
    >
      {label}
    </Link>
  );
}

/** The observatory mark: a dial with a blue centre (v2 handoff). */
export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className="flex-none"
    >
      <rect
        x="1"
        y="1"
        width="30"
        height="30"
        rx="8"
        stroke="var(--color-ink3)"
        strokeWidth="1.4"
        fill="var(--color-elev)"
      />
      <circle cx="16" cy="16" r="8" stroke="var(--color-ink3)" strokeWidth="1.2" />
      <path
        d="M16 5V9M16 23V27M5 16H9M23 16H27"
        stroke="var(--color-up)"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="16" cy="16" r="2.6" fill="var(--color-up)" />
    </svg>
  );
}

function Logo() {
  return (
    <span className="flex flex-none items-center gap-2.5">
      <LogoMark />
      <span className="flex flex-col leading-[1.15]">
        <span className="text-[15px] font-semibold text-ink">{t.appName}</span>
        <span lang="ar" dir="rtl" className="font-arabic text-xs text-ink3">
          {s.logoArabicFull}
        </span>
      </span>
    </span>
  );
}

function MarketSheetBody({
  view,
  calendar,
  now,
  health,
}: {
  view: PulseView | null;
  calendar: MarketCalendar | null;
  now: Date;
  health: Health;
}) {
  const { zone } = useDisplay();
  const c = dualClock(now, zone);
  const next = view?.session.calendarCovered && calendar ? nextRegularOpen(now, calendar) : null;
  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid grid-cols-2 gap-2.5">
        <div className="flex flex-col gap-0.5 rounded-xl bg-surface p-3.5">
          <span className="text-[0.8125rem] text-muted">{s.newYork}</span>
          <span className="text-[1.75rem] font-bold text-ink tabular-nums">{c.et}</span>
          <span className="text-[0.8125rem] text-muted">{etDate(now)}</span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-xl bg-surface p-3.5">
          <span className="text-[0.8125rem] text-muted">{zoneName(zone)}</span>
          <span className="text-[1.75rem] font-bold text-ink tabular-nums">{c.local}</span>
          <span className="text-[0.8125rem] text-muted">{etDate(now)}</span>
        </div>
      </div>
      <div className="flex flex-col gap-1 rounded-xl bg-surface p-3.5 text-[0.9375rem]">
        <span className="font-semibold text-ink">
          {view ? sessionLabel(view.session) : s.market.unknown}
        </span>
        {view && !view.session.calendarCovered && (
          <span className="text-muted">{s.uncoveredNote}</span>
        )}
        {next && (
          <span className="text-fg">
            {s.nextOpen(`${etDate(next)} ${dualClock(next, zone).label}`)}
          </span>
        )}
      </div>
      <SourceAttention view={view} health={health} />
    </div>
  );
}

function SourceAttention({ view, health }: { view: PulseView | null; health: Health }) {
  const stale = view?.stale ?? [];
  const unchecked = view?.unchecked ?? [];
  const n = stale.length + unchecked.length;
  return (
    <div className="flex flex-col gap-2.5">
      <span role="status" className={`text-[0.9375rem] ${n > 0 ? 'text-fg' : health.text}`}>
        {view ? s.attention(n) : health.label}
      </span>
      {stale.map((name) => (
        <div key={name} className="flex items-start gap-3 rounded-xl bg-surface p-3.5">
          <span className="rounded bg-warn/20 px-2 py-1 text-[0.8125rem] font-semibold text-warn">
            {s.badgeStale}
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="font-bold text-ink">{name}</span>
            <span className="text-[0.9375rem] text-fg">{s.staleTitle}</span>
          </span>
        </div>
      ))}
      {unchecked.map((name) => (
        <div key={name} className="flex items-start gap-3 rounded-xl bg-surface p-3.5">
          <span className="rounded bg-muted/15 px-2 py-1 text-[0.8125rem] font-semibold text-fg">
            {s.badgeUnchecked}
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="font-bold text-ink">{name}</span>
            <span className="text-[0.9375rem] text-muted">{s.uncheckedTitle}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function SheetLink({ tab, label, onClick }: { tab: Tab; label?: string; onClick: () => void }) {
  const Icon = tab.icon;
  const nav = useShellText().nav;
  return (
    <Link
      to={tab.to}
      onClick={onClick}
      className="flex min-h-14 items-center gap-3 rounded-xl bg-surface px-4 text-[0.9375rem] font-semibold text-ink"
    >
      <Icon aria-hidden="true" size={22} className="text-up" />
      <span className="flex-1">{label ?? nav[tab.nav]}</span>
      <ChevronRight aria-hidden="true" size={18} className="text-muted" />
    </Link>
  );
}

export function Shell() {
  useNumberShortcuts();
  const qc = useQueryClient();
  const { q, now, view, market, tone, health } = usePulse();
  const pull = usePullToRefresh(() => qc.refetchQueries({ type: 'active' }));
  const [sheet, setSheet] = useState<'none' | 'more' | 'market'>('none');
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const current = [...tabs, ...moreTabs].find((x) =>
    x.to === '/' ? pathname === '/' : pathname.startsWith(x.to),
  );
  const moreActive = moreTabs.some((x) => pathname.startsWith(x.to));
  const signOut = () => void supabase?.auth.signOut();
  const chipAria = s.chipAria(market, health.label);
  const text = useShellText();
  const { zone } = useDisplay();
  const clock = dualClock(now, zone);
  return (
    <div className="flex min-h-dvh flex-col">
      {/* Tablet and desktop: the v2 header with every page, and the session and clock chip. */}
      <header className="sticky top-0 z-40 hidden border-b border-line bg-surface pt-[env(safe-area-inset-top)] tablet:block">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-2 px-4 py-2.5">
          <Logo />
          <nav
            aria-label={text.nav.primary}
            className="flex max-w-full gap-0.5 overflow-x-auto [scrollbar-width:none]"
          >
            {[...tabs, ...moreTabs].map((tab) => (
              <TopTab key={tab.to} tab={tab} label={text.nav[tab.nav]} />
            ))}
          </nav>
          <button
            type="button"
            onClick={() => setSheet('market')}
            className="flex min-h-10 items-center gap-2 rounded-lg border border-line bg-elev px-2.5 text-xs whitespace-nowrap text-ink2"
          >
            <span aria-hidden="true" className={`size-2 flex-none rounded-full ${health.dot}`} />
            <span className={tone.split(' ').find((c) => c.startsWith('text-')) ?? ''}>
              {market}
            </span>
            <span aria-hidden="true" className="text-ink3">
              ·
            </span>
            <span dir="ltr" className="tabular-nums">
              {clock.et} {t.clock.et}
            </span>
            <span dir="ltr" className="text-ink3 tabular-nums">
              {clock.local} {zoneName(zone)}
            </span>
            {/* The visible text stays in the name; health and the action follow for screen readers. */}
            <span className="sr-only">{s.chipExtra(health.label)}</span>
          </button>
        </div>
      </header>

      {/* Phone: the page title, the market chip and the freshness dot. */}
      <header className="sticky top-0 z-40 border-b border-line bg-surface pt-[env(safe-area-inset-top)] tablet:hidden">
        <div className="flex min-h-14 items-center gap-2 py-1.5 ps-4 pe-3">
          <span className="shrink-0 text-[1.375rem] leading-tight font-bold text-ink">
            {current ? text.nav[current.nav] : t.appName}
          </span>
          <button
            type="button"
            aria-label={chipAria}
            onClick={() => setSheet('market')}
            className={`ms-auto flex min-h-11 min-w-0 items-center gap-1.5 rounded-full px-2.5 text-[0.8125rem] font-semibold ${tone}`}
          >
            <span className="truncate">{market}</span>
          </button>
          <button
            type="button"
            aria-label={chipAria}
            onClick={() => setSheet('market')}
            className={`flex min-h-11 min-w-11 items-center gap-1.5 rounded-full px-2 text-[0.8125rem] whitespace-nowrap ${health.text}`}
          >
            <span aria-hidden="true" className={`size-2.5 flex-none rounded-full ${health.dot}`} />
            {/* A count in words when something needs a look; otherwise the dot, with the state in the label. */}
            {health.count ? health.label : null}
          </button>
        </div>
      </header>

      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+4.5rem)] z-30 flex justify-center tablet:hidden"
      >
        {pull.phase !== 'idle' && (
          <span className="flex items-center gap-2 rounded-full bg-raised px-3.5 py-2 text-[0.8125rem] text-fg shadow-lg">
            <RefreshCw
              aria-hidden="true"
              size={16}
              className={
                pull.phase === 'refreshing' ? 'animate-spin motion-reduce:animate-none' : ''
              }
            />
            {pull.text}
          </span>
        )}
      </div>

      <main className="mx-auto w-full max-w-[1280px] flex-1 p-4 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] tablet:p-6 tablet:pb-10">
        <QuickLookProvider>
          <Outlet />
        </QuickLookProvider>
      </main>

      <footer className="mx-auto mb-[calc(env(safe-area-inset-bottom)+4.5rem)] flex w-full max-w-[1280px] flex-wrap items-center justify-between gap-2 border-t border-line p-4 text-xs text-ink3 tablet:mb-0">
        <span>{text.footer}</span>
        <span dir="ltr" className="tabular-nums">
          {etDate(now)} · {clock.et} {t.clock.et} ({clock.local} {zoneName(zone)})
        </span>
      </footer>

      {/* Phone: the bottom tab bar, with Lab, Status and Sign out under More. */}
      <nav
        aria-label={text.nav.primary}
        className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-6 border-t border-faint/30 bg-surface pb-[env(safe-area-inset-bottom)] tablet:hidden"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <Link
              key={tab.to}
              to={tab.to}
              activeOptions={{ exact: tab.to === '/' }}
              className="group flex min-h-14 flex-col items-center justify-center gap-0.5 text-[0.6875rem] text-muted"
              activeProps={{ className: 'text-up! font-semibold', 'aria-current': 'page' }}
            >
              <Icon aria-hidden="true" size={24} strokeWidth={1.75} />
              {text.nav[tab.nav]}
            </Link>
          );
        })}
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={sheet === 'more'}
          onClick={() => setSheet('more')}
          className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[0.6875rem] ${
            moreActive ? 'font-semibold text-up' : 'text-muted'
          }`}
        >
          <Ellipsis aria-hidden="true" size={24} strokeWidth={1.75} />
          {s.more}
        </button>
      </nav>

      <Sheet open={sheet === 'more'} onClose={() => setSheet('none')} title={s.more}>
        <div className="flex flex-col gap-2">
          {moreTabs.map((tab) => (
            <SheetLink key={tab.to} tab={tab} onClick={() => setSheet('none')} />
          ))}
          <button
            type="button"
            onClick={signOut}
            className="flex min-h-14 items-center gap-3 rounded-xl bg-surface px-4 text-[0.9375rem] font-semibold text-ink"
          >
            <LogOut aria-hidden="true" size={22} className="text-muted" />
            {text.nav.signOut}
          </button>
        </div>
      </Sheet>
      <Sheet open={sheet === 'market'} onClose={() => setSheet('none')} title={s.marketTitle}>
        <MarketSheetBody
          view={view}
          calendar={q.data?.calendar ?? null}
          now={now}
          health={health}
        />
        <SheetLink tab={moreTabs[1] as Tab} label={s.openStatus} onClick={() => setSheet('none')} />
      </Sheet>
    </div>
  );
}
