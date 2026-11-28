import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from '@tanstack/react-router';
import { Shell } from './components/Shell';
import { Watch } from './routes/Watch';
import { stringSearch } from './lib/view';

/** `?view=` on pages with switchable areas (ADR 0048); the page checks the value against its own views. */
const viewSearch = stringSearch('view');

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
    path: '/regime',
    component: lazyRouteComponent(() => import('./routes/Regime'), 'Regime'),
  }),
  createRoute({
    getParentRoute: () => root,
    path: '/alerts',
    component: lazyRouteComponent(() => import('./routes/Alerts'), 'Alerts'),
  }),
  createRoute({
    getParentRoute: () => root,
    path: '/journal',
    validateSearch: stringSearch('view', 'ticker'),
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
