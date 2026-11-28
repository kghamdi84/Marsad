import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from '@tanstack/react-router';
import { Shell } from './components/Shell';
import { Watch } from './routes/Watch';
import { stringSearch } from './lib/view';

/** `?view=` on pages with switchable areas (ADR 0048); the page checks the value against its own views. */
const viewSearch = stringSearch('view');

/**
 * Journal tabs that moved to Portfolio (ADR 0048), mapped to the Portfolio view that now holds them, so an old link
 * or bookmark still lands on the right content.
 */
const MOVED_FROM_JOURNAL: Record<string, string> = {
  positions: 'holdings',
  portfolio: 'review',
  options: 'holdings',
  exposure: 'analysis',
};

const root = createRootRoute({ component: Shell });

// Watch is the landing page and loads with the app; every other page loads its own chunk on first visit
// (Phase 8 performance pass), so an iPad on a mobile connection downloads only what it shows.
const routeTree = root.addChildren([
  createRoute({ getParentRoute: () => root, path: '/', component: Watch }),
  createRoute({
    getParentRoute: () => root,
    path: '/study',
    component: lazyRouteComponent(() => import('./routes/Study'), 'Study'),
  }),
  createRoute({
    getParentRoute: () => root,
    path: '/study/$ticker',
    validateSearch: viewSearch,
    component: lazyRouteComponent(() => import('./routes/StudyCompany'), 'StudyCompany'),
  }),
  createRoute({
    getParentRoute: () => root,
    path: '/markets',
    validateSearch: viewSearch,
    component: lazyRouteComponent(() => import('./routes/Markets'), 'Markets'),
  }),
  // The Regime page became the Markets regime view (ADR 0048); old links keep their hash (a card's anchor).
  createRoute({
    getParentRoute: () => root,
    path: '/regime',
    beforeLoad: ({ location }) => {
      throw redirect({
        to: '/markets',
        search: { view: 'regime' },
        hash: location.hash.replace(/^#/, ''),
        replace: true,
      });
    },
  }),
  createRoute({
    getParentRoute: () => root,
    path: '/alerts',
    component: lazyRouteComponent(() => import('./routes/Alerts'), 'Alerts'),
  }),
  createRoute({
    getParentRoute: () => root,
    path: '/portfolio',
    validateSearch: viewSearch,
    component: lazyRouteComponent(() => import('./routes/Portfolio'), 'Portfolio'),
  }),
  createRoute({
    getParentRoute: () => root,
    path: '/journal',
    validateSearch: stringSearch('view', 'ticker'),
    beforeLoad: ({ search }) => {
      const moved = search.view ? MOVED_FROM_JOURNAL[search.view] : undefined;
      if (moved) throw redirect({ to: '/portfolio', search: { view: moved }, replace: true });
    },
    component: lazyRouteComponent(() => import('./routes/Journal'), 'Journal'),
  }),
  createRoute({
    getParentRoute: () => root,
    path: '/status',
    validateSearch: viewSearch,
    component: lazyRouteComponent(() => import('./routes/Status'), 'Status'),
  }),
  createRoute({
    getParentRoute: () => root,
    path: '/lab',
    component: lazyRouteComponent(() => import('./routes/Lab'), 'Lab'),
  }),
  createRoute({
    getParentRoute: () => root,
    path: '/settings',
    validateSearch: viewSearch,
    component: lazyRouteComponent(() => import('./routes/Settings'), 'Settings'),
  }),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
