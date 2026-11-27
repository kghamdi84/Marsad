import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import './styles.css';
import { useAuthGate } from './auth/useAuthGate';
import { SignIn } from './auth/SignIn';
import { Mfa } from './auth/Mfa';
import { Panel } from './components/ui';
import { router } from './router';
import { t } from './strings';
import { EOD_STALE_MS } from './lib/refresh';

const queryClient = new QueryClient({
  // End-of-day data stays fresh for 30 minutes (ADR 0042); quotes set their own market-hours poll.
  defaultOptions: { queries: { retry: 1, staleTime: EOD_STALE_MS } },
});

function App() {
  const { gate, refresh } = useAuthGate();
  switch (gate) {
    case 'config-missing':
      return (
        <Panel title={t.configMissing.title}>
          <p className="text-muted">{t.configMissing.body}</p>
        </Panel>
      );
    case 'loading':
      return <p className="p-6 text-muted">{t.loading}</p>;
    case 'signed-out':
      return <SignIn />;
    case 'mfa-enroll':
      return <Mfa mode="enroll" onDone={refresh} />;
    case 'mfa-verify':
      return <Mfa mode="verify" onDone={refresh} />;
    case 'ready':
      return (
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      );
  }
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Missing #root element');
createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
