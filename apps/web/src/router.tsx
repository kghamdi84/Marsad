import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { Shell } from './components/Shell';
import { Placeholder } from './routes/Placeholder';
import { Regime } from './routes/Regime';
import { Status } from './routes/Status';
import { Study } from './routes/Study';
import { StudyCompany } from './routes/StudyCompany';
import { t } from './strings';

const root = createRootRoute({ component: Shell });

const page = (path: string, title: string, phase: number) =>
  createRoute({
    getParentRoute: () => root,
    path,
    component: () => <Placeholder title={title} phase={phase} />,
  });

const routeTree = root.addChildren([
  page('/', t.nav.watch, 3),
  createRoute({ getParentRoute: () => root, path: '/study', component: Study }),
  createRoute({ getParentRoute: () => root, path: '/study/$ticker', component: StudyCompany }),
  createRoute({ getParentRoute: () => root, path: '/regime', component: Regime }),
  page('/alerts', t.nav.alerts, 5),
  page('/journal', t.nav.journal, 7),
  createRoute({ getParentRoute: () => root, path: '/status', component: Status }),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
