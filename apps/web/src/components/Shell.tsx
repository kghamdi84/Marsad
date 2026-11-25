import { useEffect } from 'react';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { DEFAULT_LOCAL_ZONE } from '@marsad/core';
import { supabase } from '../lib/supabase';
import { t } from '../strings';
import { Clock } from './Clock';

const tabs = [
  { to: '/', label: t.nav.watch, key: '1' },
  { to: '/study', label: t.nav.study, key: '2' },
  { to: '/regime', label: t.nav.regime, key: '3' },
  { to: '/alerts', label: t.nav.alerts, key: '4' },
  { to: '/journal', label: t.nav.journal, key: '5' },
] as const;

function useNumberShortcuts() {
  const navigate = useNavigate();
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)))
        return;
      const tab = tabs.find((x) => x.key === e.key);
      if (tab) void navigate({ to: tab.to });
      else if (e.key === 's') void navigate({ to: '/status' });
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);
}

export function Shell() {
  useNumberShortcuts();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-line bg-surface ps-4 pe-2 pt-[env(safe-area-inset-top)]">
        <span className="font-semibold tracking-wide">{t.appName}</span>
        <Clock localZone={DEFAULT_LOCAL_ZONE} />
        <div className="flex items-center">
          <Link
            to="/lab"
            className="flex min-h-11 items-center px-3 text-muted hover:text-fg"
            activeProps={{
              className: 'text-fg underline underline-offset-4',
              'aria-current': 'page',
            }}
          >
            {t.nav.lab}
          </Link>
          <Link
            to="/status"
            className="flex min-h-11 items-center px-3 text-muted hover:text-fg"
            activeProps={{
              className: 'text-fg underline underline-offset-4',
              'aria-current': 'page',
            }}
          >
            {t.nav.status}
          </Link>
          <button
            type="button"
            className="min-h-11 px-3 text-muted hover:text-fg"
            onClick={() => void supabase?.auth.signOut()}
          >
            {t.nav.signOut}
          </button>
        </div>
      </header>
      <div className="flex-1 overflow-auto p-4">
        <Outlet />
      </div>
      <nav
        aria-label={t.nav.primary}
        className="sticky bottom-0 grid grid-cols-5 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
      >
        {tabs.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            activeOptions={{ exact: tab.to === '/' }}
            className="flex min-h-12 items-center justify-center border-t-2 border-transparent text-muted"
            activeProps={{
              className: 'border-t-focus! text-fg font-medium',
              'aria-current': 'page',
            }}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
