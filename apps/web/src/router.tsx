import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { Shell } from './components/Shell';
import { Alerts } from './routes/Alerts';
import { Journal } from './routes/Journal';
import { Lab } from './routes/Lab';
import { Regime } from './routes/Regime';
import { Status } from './routes/Status';
import { Study } from './routes/Study';
import { StudyCompany } from './routes/StudyCompany';
import { Watch } from './routes/Watch';

const root = createRootRoute({ component: Shell });

const routeTree = root.addChildren([
  createRoute({ getParentRoute: () => root, path: '/', component: Watch }),
  createRoute({ getParentRoute: () => root, path: '/study', component: Study }),
  createRoute({ getParentRoute: () => root, path: '/study/$ticker', component: StudyCompany }),
  createRoute({ getParentRoute: () => root, path: '/regime', component: Regime }),
  createRoute({ getParentRoute: () => root, path: '/alerts', component: Alerts }),
  createRoute({ getParentRoute: () => root, path: '/journal', component: Journal }),
  createRoute({ getParentRoute: () => root, path: '/status', component: Status }),
  createRoute({ getParentRoute: () => root, path: '/lab', component: Lab }),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
